import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// This test intentionally commits fictional fixtures across independent sessions.
// It must run only on the disposable CLI-managed LOCAL Supabase database. It has
// no connection-URL argument and does not read application/provider credentials.
// Run npm run db:reset immediately before this test. Invoking it authorizes a
// second local reset for teardown. The row guard below is only a tripwire, not a
// backup or an exhaustive comparison of edited seed content/future tables.
const container = 'supabase_db_trot-you';
const docker = ['--context', 'default'];
const timeoutMs = 15_000;
const clients = new Set();
let commandSequence = 0;

function assertLocalDocker() {
  assert.ok(
    !process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT,
    'Unset Docker host/context overrides before running local database tests.',
  );
  assert.equal(
    execFileSync('docker', ['context', 'show'], { encoding: 'utf8' }).trim(),
    'default',
    'Select the default local Docker context before running database tests.',
  );
  const endpoint = execFileSync(
    'docker',
    [...docker, 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
    { encoding: 'utf8' },
  ).trim();
  assert.ok(
    endpoint.startsWith('unix://'),
    'Concurrency tests require a local Unix-socket Docker context.',
  );
}

class Session {
  constructor(label) {
    this.label = `settlement-concurrency-${label}`;
    this.stderr = '';
    this.buffer = '';
    this.pending = null;
    this.closed = false;
    this.process = spawn('docker', [
      ...docker,
      'exec',
      '-i',
      container,
      'psql',
      '-X',
      '-A',
      '-t',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'postgres',
    ]);
    clients.add(this);
    this.process.stdout.setEncoding('utf8');
    this.process.stderr.setEncoding('utf8');
    this.process.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      let newline;
      while ((newline = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, newline).replace(/\r$/, '');
        this.buffer = this.buffer.slice(newline + 1);
        if (!this.pending) continue;
        if (line === this.pending.marker) {
          const pending = this.pending;
          this.pending = null;
          clearTimeout(pending.timer);
          pending.resolve(pending.lines.join('\n').trim());
        } else {
          this.pending.lines.push(line);
        }
      }
    });
    this.process.stderr.on('data', (chunk) => {
      this.stderr += chunk;
    });
    this.process.on('error', (error) => this.reject(error));
    this.done = new Promise((resolve) => {
      this.process.on('close', (code) => {
        this.closed = true;
        clients.delete(this);
        this.reject(
          new Error(`${this.label}: psql exited ${code}: ${this.stderr}`),
        );
        resolve();
      });
    });
  }

  reject(error) {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  query(sql) {
    assert.ok(!this.closed, `${this.label} is closed`);
    assert.equal(this.pending, null, `${this.label} already has pending SQL`);
    const marker = `SETTLEMENT_TEST_DONE_${++commandSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.reject(new Error(`${this.label}: SQL command timed out`));
        this.process.kill('SIGTERM');
      }, timeoutMs);
      this.pending = { marker, lines: [], resolve, reject, timer };
      this.process.stdin.write(`${sql}\n\\echo ${marker}\n`);
    });
  }

  async initialize() {
    await this.query(`
      set application_name = '${this.label}';
      set statement_timeout = '${timeoutMs}ms';
      set lock_timeout = '${timeoutMs}ms';
      set timezone = 'UTC';
    `);
    return this;
  }

  async close() {
    if (!this.closed) this.process.stdin.end('\\q\n');
    await this.done;
  }
}

async function session(label) {
  return new Session(label).initialize();
}

async function waitForBlock(observer, waiting, blocking) {
  const deadline = Date.now() + timeoutMs / 2;
  while (Date.now() < deadline) {
    const result = await observer.query(`
      select exists (
        select 1 from pg_stat_activity waiting, pg_stat_activity blocking
        where waiting.application_name = '${waiting.label}'
          and blocking.application_name = '${blocking.label}'
          and waiting.wait_event_type = 'Lock'
          and blocking.pid = any(pg_blocking_pids(waiting.pid))
      );
    `);
    if (result === 't') return;
    await delay(25);
  }
  throw new Error(`${waiting.label} never blocked on ${blocking.label}`);
}

// All identities, historical ledger rows and contract policies are fictional.
// Historical charge fixtures use local-owner SQL because the billing RPC rightly
// rejects invented backdated approvals. Refunds and reporting execute real RPCs
// under service_role / authenticated, never owner authority. This is not proof
// of a provider verification, accounting policy approval or a transfer.
const uuid = () => crypto.randomUUID();
const service = (sql) => `set local role service_role; ${sql}`;
const authenticated = (userId, sql) =>
  `set local role authenticated; set local "request.jwt.claim.sub" = '${userId}'; ${sql}`;
const localCli = fileURLToPath(
  new URL('../node_modules/.bin/supabase', import.meta.url),
);
let shouldReset = false;

// Keep the winner's real RPC uncommitted until PostgreSQL proves the contender
// is blocked on it. Timeouts/deadlocks are failures, not expected race outcomes.
async function race(db, label, firstSql, secondSql, finalize = 'commit') {
  const first = await session(`${label}-first`);
  const second = await session(`${label}-second`);
  try {
    const winner = await first.query(`begin; ${firstSql}`);
    const following = second.query(`begin; ${secondSql} commit;`).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await waitForBlock(db, second, first);
    assert.ok(finalize === 'commit' || finalize === 'rollback');
    await first.query(`${finalize};`);
    return { winner, following: await following };
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
}

// Adversarial lock order: a source row is already FOR UPDATE before the report
// acquires EXCLUSIVE. The report must finish without taking a source FK lock;
// the source writer then waits for the report fence instead of deadlocking.
async function sourceRowFenceRace(db, label, lockedSql, writeSql, reportSql) {
  const writer = await session(`${label}-writer`);
  const reporter = await session(`${label}-reporter`);
  try {
    await writer.query(`begin; ${lockedSql}`);
    const report = await reporter.query(`begin; ${reportSql}`);
    const following = writer.query(`${writeSql} commit;`).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await waitForBlock(db, writer, reporter);
    await reporter.query('commit;');
    return { report, following: await following };
  } finally {
    await Promise.all([writer.close(), reporter.close()]);
  }
}

const execute = (db, sql) => db.query(`begin; ${sql} commit;`);
const assertError = (result, expected) =>
  assert.match(result.error?.message ?? '', expected);
const calculate = (fixture, month = '2026-01-01') =>
  authenticated(
    fixture.admin,
    `select public.settlement_calculate('${fixture.artist}','${month}');`,
  );
const confirm = (fixture, report, revision) =>
  authenticated(
    fixture.admin,
    `select public.settlement_confirm('${report}','${revision}');`,
  );
const queue = (fixture, event, month = '2026-02-01') =>
  authenticated(
    fixture.admin,
    `select public.settlement_queue_adjustment('${event}','${month}');`,
  );
const refund = (fixture, action = uuid()) =>
  service(
    `select public.billing_record_refund('${fixture.charge}','fictional-${action}',1000,
    'KRW','2026-01-15 00:00:00+09','${uuid()}');`,
  );
const revision = (db, report) =>
  db.query(`select revision from public.settlements where id='${report}';`);
const gross = (db, report) =>
  db.query(`select gross_krw from public.settlements where id='${report}';`);
const state = (db, report) =>
  db.query(`select status from public.settlements where id='${report}';`);
const snapshot = (db, report) =>
  db.query(
    `select to_jsonb(r)::text from public.settlements r where id='${report}';`,
  );

async function fixture(db, admin) {
  const user = uuid(),
    artist = uuid(),
    subscription = uuid(),
    charge = uuid();
  await db.query(`
    insert into auth.users(id,email,raw_user_meta_data) values('${user}','settlement-${user}@example.invalid','{}');
    update public.profiles set call_name='Fictional settlement fan',onboarding_completed_at=clock_timestamp() where id='${user}';
    insert into public.artists(id,slug,name,grade,status) values('${artist}','settlement-${artist}','Fictional settlement artist','B','active');
    insert into public.subscriptions(id,user_id,artist_id,provider) values('${subscription}','${user}','${artist}','toss');
    insert into public.payment_events(id,subscription_id,kind,amount_krw,currency,provider,period_start,period_end,occurred_at)
      values('${charge}','${subscription}','charge',6500,'KRW','toss','2026-01-01 00:00:00+09','2026-02-01 00:00:00+09','2026-01-02 00:00:00+09');
    insert into private.payment_event_verifications(event_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
      values('${charge}','toss','test','fictional-settlement-merchant','fictional-${charge}','${uuid()}');
    insert into private.settlement_policies(artist_id,month,enabled,contract_from,contract_until,base_rate,performance_rate,
      vat_rate,pg_fee_rate,activity_enabled,partial_week_policy,late_event_policy)
      select '${artist}',m::date,true,'2026-01-01','2027-01-01',0.3,0.4,0.1,0.03,false,'prorate_days','explicit_current_formula'
      from generate_series('2026-01-01'::timestamp,'2026-03-01'::timestamp,interval '1 month') m;
  `);
  return { user, artist, subscription, charge, admin };
}

async function lateFixture(db, admin) {
  const f = await fixture(db, admin);
  const nextCharge = uuid();
  await db.query(`
    insert into public.payment_events(id,subscription_id,kind,amount_krw,currency,provider,period_start,period_end,occurred_at)
      values('${nextCharge}','${f.subscription}','charge',6500,'KRW','toss','2026-02-01 00:00:00+09','2026-03-01 00:00:00+09','2026-02-02 00:00:00+09');
    insert into private.payment_event_verifications(event_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
      values('${nextCharge}','toss','test','fictional-settlement-merchant','fictional-${nextCharge}','${uuid()}');
  `);
  const report = await execute(db, calculate(f));
  await execute(db, confirm(f, report, await revision(db, report)));
  const event = await execute(db, refund(f));
  return { ...f, report, event };
}

async function testConcurrency(db) {
  const admin = uuid();
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values('${admin}','settlement-admin-${admin}@example.invalid','{}');
    update public.profiles set role='admin',call_name='Fictional settlement administrator',onboarding_completed_at=clock_timestamp() where id='${admin}';`);

  // 1. The exclusive reporting fence serializes duplicate artist/month upserts.
  const duplicate = await fixture(db, admin);
  const double = await race(
    db,
    'duplicate-calculate',
    calculate(duplicate),
    calculate(duplicate),
  );
  assert.equal(double.following.error, undefined);
  assert.equal(double.following.value, double.winner);
  assert.equal(
    await db.query(
      `select count(*) from public.settlements where artist_id='${duplicate.artist}';`,
    ),
    '1',
  );
  assert.equal(await gross(db, double.winner), '6500');
  console.info(
    'PASS: concurrent calculation returns one report identity without duplicate sources',
  );

  // 2. The source transaction holds the fence through both event and evidence.
  const refundFirst = await fixture(db, admin);
  const before = await race(
    db,
    'refund-before-calculate',
    refund(refundFirst),
    calculate(refundFirst),
  );
  assert.equal(before.following.error, undefined);
  assert.equal(await gross(db, before.following.value), '5500');
  assert.equal(
    await db.query(
      `select count(*) from private.settlement_event_sources where report_id='${before.following.value}';`,
    ),
    '2',
  );
  console.info(
    'PASS: calculation waits for verified refund commit and snapshots both matching sources',
  );

  // 3. Waiting for a rolled-back writer must not include its event or version.
  const rollback = await fixture(db, admin);
  const aborted = await race(
    db,
    'refund-rollback',
    refund(rollback),
    calculate(rollback),
    'rollback',
  );
  assert.equal(aborted.following.error, undefined);
  assert.equal(await gross(db, aborted.following.value), '6500');
  assert.equal(
    await db.query(
      `select count(*) from public.payment_events where id='${aborted.winner}';`,
    ),
    '0',
  );
  console.info('PASS: source rollback is invisible to a waiting calculation');

  // 4. Reviewing draft revision A cannot accidentally confirm concurrent B.
  const changed = await fixture(db, admin);
  const changedReport = await execute(db, calculate(changed));
  const oldRevision = await revision(db, changedReport);
  const recalculated = await race(
    db,
    'recalculate-before-confirm',
    calculate(changed),
    confirm(changed, changedReport, oldRevision),
  );
  assertError(recalculated.following, /SETTLEMENT_REVISION_CONFLICT/);
  assert.equal(await state(db, changedReport), 'draft');
  assert.notEqual(await revision(db, changedReport), oldRevision);
  console.info(
    'PASS: stale reviewer revision cannot confirm a newly calculated draft',
  );

  // 5. A committed refund invalidates the snapshot even without recalculation.
  const stale = await fixture(db, admin);
  const staleReport = await execute(db, calculate(stale));
  const staleVersion = await revision(db, staleReport);
  const staleConfirm = await race(
    db,
    'refund-before-confirm',
    refund(stale),
    confirm(stale, staleReport, staleVersion),
  );
  assertError(staleConfirm.following, /SETTLEMENT_DRAFT_STALE/);
  assert.equal(await state(db, staleReport), 'draft');
  assert.equal(await gross(db, staleReport), '6500');
  console.info(
    'PASS: confirmation waits for source commit then rejects the stale source snapshot',
  );

  // 6. Reverse order: confirmation wins, later refund cannot rewrite the report.
  const confirmed = await fixture(db, admin);
  const confirmedReport = await execute(db, calculate(confirmed));
  const confirmedVersion = await revision(db, confirmedReport);
  const after = await race(
    db,
    'confirm-before-refund',
    confirm(confirmed, confirmedReport, confirmedVersion),
    refund(confirmed),
  );
  assert.equal(after.following.error, undefined);
  const frozen = await snapshot(db, confirmedReport);
  assert.equal(await state(db, confirmedReport), 'confirmed');
  assert.equal(await gross(db, confirmedReport), '6500');
  assert.equal(
    await execute(
      db,
      authenticated(
        admin,
        `select count(*) from public.settlement_pending_adjustments('${confirmed.artist}');`,
      ),
    ),
    '1',
  );
  await execute(db, confirm(confirmed, confirmedReport, confirmedVersion));
  assert.equal(await snapshot(db, confirmedReport), frozen);
  console.info(
    'PASS: confirm-first preserves the frozen report and exposes the late refund separately',
  );

  // 7. A duplicate explicitly requested adjustment is recorded once.
  const same = await lateFixture(db, admin);
  const sameQueue = await race(
    db,
    'duplicate-adjustment',
    queue(same, same.event),
    queue(same, same.event),
  );
  assert.equal(sameQueue.following.error, undefined);
  assert.equal(
    await db.query(
      `select count(*) from private.settlement_adjustments where event_id='${same.event}';`,
    ),
    '1',
  );
  console.info(
    'PASS: concurrent identical adjustment requests reserve one source event',
  );

  // 8. A different target month may not steal the same source reservation.
  const conflicting = await lateFixture(db, admin);
  const conflict = await race(
    db,
    'conflicting-adjustment',
    queue(conflicting, conflicting.event),
    queue(conflicting, conflicting.event, '2026-03-01'),
  );
  assertError(conflict.following, /SETTLEMENT_ADJUSTMENT_CONFLICT/);
  assert.equal(
    await db.query(
      `select target_month from private.settlement_adjustments where event_id='${conflicting.event}';`,
    ),
    '2026-02-01',
  );
  console.info(
    'PASS: concurrent conflicting target month fails without changing the first adjustment',
  );

  // 9. A target calculation waits for and incorporates the explicit adjustment.
  const queued = await lateFixture(db, admin);
  const queuedResult = await race(
    db,
    'adjustment-before-calculate',
    queue(queued, queued.event),
    calculate(queued, '2026-02-01'),
  );
  assert.equal(queuedResult.following.error, undefined);
  assert.equal(await gross(db, queuedResult.following.value), '5500');
  assert.equal(
    await db.query(
      `select adjustment_gross_krw from public.settlements where id='${queuedResult.following.value}';`,
    ),
    '-1000',
  );
  console.info(
    'PASS: waiting target calculation includes the separately authorized late adjustment',
  );

  // 10. Reverse order invalidates the target draft rather than mutating it.
  const lateQueue = await lateFixture(db, admin);
  const lateResult = await race(
    db,
    'calculate-before-adjustment',
    calculate(lateQueue, '2026-02-01'),
    queue(lateQueue, lateQueue.event),
  );
  assert.equal(lateResult.following.error, undefined);
  assert.equal(await gross(db, lateResult.winner), '6500');
  const rejected = await session('stale-target-confirm');
  try {
    await assert.rejects(
      rejected.query(
        `begin; ${confirm(lateQueue, lateResult.winner, await revision(db, lateResult.winner))} commit;`,
      ),
      /SETTLEMENT_DRAFT_STALE/,
    );
  } finally {
    await rejected.close();
  }
  const refreshed = await execute(db, calculate(lateQueue, '2026-02-01'));
  assert.equal(refreshed, lateResult.winner);
  assert.equal(await gross(db, refreshed), '5500');
  console.info(
    'PASS: a newly queued adjustment invalidates an older target draft until recalculation',
  );

  // 11. Mutable activity rows use the same fence. Owner SQL here is only the
  // fictional historical cancellation fixture, never application authority.
  const messages = await fixture(db, admin);
  const messageId = uuid();
  await db.query(`insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
    values('${messageId}','${messages.artist}','${admin}','photo','Fictional historical photo','sent','2026-01-10 00:00:00+09','2026-01-10 00:00:00+09');`);
  const canceled = await race(
    db,
    'message-cancel-before-calculate',
    `update public.messages set status='canceled',canceled_at='2026-01-10 00:00:01+09' where id='${messageId}';`,
    calculate(messages),
  );
  assert.equal(canceled.following.error, undefined);
  assert.equal(
    await db.query(
      `select source_message_count from public.settlements where id='${canceled.following.value}';`,
    ),
    '0',
  );
  assert.equal(
    await db.query(
      `select sum(photo_count) from public.settlement_weekly_stats where report_id='${canceled.following.value}';`,
    ),
    '0',
  );
  console.info(
    'PASS: cancellation commit is reflected consistently in message IDs and weekly metrics',
  );

  // 12. Contract/rate snapshot changes also wait on the source fence.
  const policy = await fixture(db, admin);
  const changedPolicy = await race(
    db,
    'policy-before-calculate',
    `update private.settlement_policies set base_rate=0.25 where artist_id='${policy.artist}' and month='2026-01-01';`,
    calculate(policy),
  );
  assert.equal(changedPolicy.following.error, undefined);
  assert.equal(
    await db.query(
      `select rate=0.25 and (policy_snapshot->>'base_rate')::numeric=0.25 from public.settlements where id='${changedPolicy.following.value}';`,
    ),
    't',
  );
  console.info(
    'PASS: calculation uses the committed policy consistently in snapshot and exact formula',
  );

  // 13. A competing calculation cannot overwrite a just-confirmed report.
  const lock = await fixture(db, admin);
  const lockedReport = await execute(db, calculate(lock));
  const locked = await race(
    db,
    'confirm-before-recalculate',
    confirm(lock, lockedReport, await revision(db, lockedReport)),
    calculate(lock),
  );
  assertError(locked.following, /SETTLEMENT_CONFIRMED/);
  assert.equal(await state(db, lockedReport), 'confirmed');
  assert.equal(await gross(db, lockedReport), '6500');
  console.info(
    'PASS: confirmation prevents the waiting upsert from replacing any report component',
  );

  // 14. A late source waiting behind calculation makes that draft stale only
  // after its commit; it never leaks half of event+verification into the report.
  const calcFirst = await fixture(db, admin);
  const later = await race(
    db,
    'calculate-before-refund',
    calculate(calcFirst),
    refund(calcFirst),
  );
  assert.equal(later.following.error, undefined);
  assert.equal(await gross(db, later.winner), '6500');
  const finalCheck = await session('calculate-first-stale-confirm');
  try {
    await assert.rejects(
      finalCheck.query(
        `begin; ${confirm(calcFirst, later.winner, await revision(db, later.winner))} commit;`,
      ),
      /SETTLEMENT_DRAFT_STALE/,
    );
  } finally {
    await finalCheck.close();
  }
  assert.equal(
    await gross(db, await execute(db, calculate(calcFirst))),
    '5500',
  );
  console.info(
    'PASS: calculation-first snapshot remains stable and cannot confirm after a later refund',
  );

  // 15. Refund already owns its original charge before reaching the fence.
  // Snapshot FK locks would deadlock this interleave; source UUIDs do not lock it.
  const heldCharge = await fixture(db, admin);
  const heldRefund = await sourceRowFenceRace(
    db,
    'held-charge-before-report',
    `select id from public.payment_events where id='${heldCharge.charge}' for update;`,
    refund(heldCharge),
    calculate(heldCharge),
  );
  assert.equal(heldRefund.following.error, undefined);
  assert.equal(await gross(db, heldRefund.report), '6500');
  assert.equal(
    await gross(db, await execute(db, calculate(heldCharge))),
    '5500',
  );
  console.info(
    'PASS: pre-held original charge row and report fence complete without FK lock inversion',
  );

  // 16. The same guarantee holds for a mutable message source row.
  const heldMessage = await fixture(db, admin);
  const heldMessageId = uuid();
  await db.query(`insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
    values('${heldMessageId}','${heldMessage.artist}','${admin}','photo','Fictional held photo','sent','2026-01-12 00:00:00+09','2026-01-12 00:00:00+09');`);
  const heldCancellation = await sourceRowFenceRace(
    db,
    'held-message-before-report',
    `select id from public.messages where id='${heldMessageId}' for update;`,
    `update public.messages set status='canceled',canceled_at='2026-01-12 00:00:01+09' where id='${heldMessageId}';`,
    calculate(heldMessage),
  );
  assert.equal(heldCancellation.following.error, undefined);
  assert.equal(
    await db.query(
      `select source_message_count from public.settlements where id='${heldCancellation.report}';`,
    ),
    '1',
  );
  await execute(db, calculate(heldMessage));
  assert.equal(
    await db.query(
      `select source_message_count from public.settlements where id='${heldCancellation.report}';`,
    ),
    '0',
  );
  console.info(
    'PASS: pre-held message row and report fence avoid deadlock and preserve a stable snapshot',
  );

  // LOCK-ONLY SCENARIOS: these require independent sessions and must not be
  // represented as successful races by a supplemental sequential SQL smoke.
  // 17. A source RPC may hold artist FOR UPDATE before reaching its SHARE fence.
  // Reporting must fail NOWAIT explicitly, releasing EXCLUSIVE on rollback.
  const busyArtist = await fixture(db, admin);
  const artistOwner = await session('busy-artist-source');
  const busyReporter = await session('busy-artist-report');
  try {
    await busyReporter.query('\\set VERBOSITY verbose');
    await artistOwner.query(
      `begin; select id from public.artists where id='${busyArtist.artist}' for update;`,
    );
    // Await failure BEFORE releasing the artist row. A lock timeout/deadlock is
    // not accepted: only the deliberate retryable SOURCE_BUSY result is valid.
    await assert.rejects(
      busyReporter.query(`begin; ${calculate(busyArtist)} commit;`),
      /40001: SETTLEMENT_SOURCE_BUSY/,
    );
    assert.equal(
      await db.query(
        `select count(*) from public.settlements where artist_id='${busyArtist.artist}';`,
      ),
      '0',
    );
    await artistOwner.query(`${refund(busyArtist)} commit;`);
    const retry = await execute(db, calculate(busyArtist));
    assert.equal(await gross(db, retry), '5500');
  } finally {
    await Promise.all([artistOwner.close(), busyReporter.close()]);
  }
  console.info(
    'PASS: artist-row contention returns SOURCE_BUSY without waiting, and whole-transaction retry succeeds',
  );

  // 18. A multi-artist source transaction already owns SHARE(A). Reporting B
  // waits EXCLUSIVE without prelocking B, so the source may safely lock/mutate B.
  const artistA = await fixture(db, admin);
  const artistB = await fixture(db, admin);
  const batchWriter = await session('multi-artist-source');
  const batchReporter = await session('multi-artist-report');
  try {
    await batchWriter.query(`begin; ${refund(artistA)}`);
    const waitingReport = batchReporter
      .query(`begin; ${calculate(artistB)} commit;`)
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    await waitForBlock(db, batchReporter, batchWriter);
    // This must complete while both transactions are still open. A report that
    // prelocked artist B would invert the global-fence/artist-row order here.
    await batchWriter.query(
      `select id from public.artists where id='${artistB.artist}' for update; ${refund(artistB)}`,
    );
    await waitForBlock(db, batchReporter, batchWriter);
    await batchWriter.query('commit;');
    const result = await waitingReport;
    assert.equal(result.error, undefined);
    assert.equal(await gross(db, result.value), '5500');
  } finally {
    await Promise.all([batchWriter.close(), batchReporter.close()]);
  }
  console.info(
    'PASS: multi-artist source transaction completes while reporting waits without lock-order inversion',
  );
  // END LOCK-ONLY SCENARIOS
}

try {
  assertLocalDocker();
  const db = await session('observer');
  // Refuse user data before authorizing fixture writes or the teardown reset.
  // Private bucket configuration is a migration, not a user data row.
  assert.equal(
    await db.query(`select
      (select count(*) from auth.users) +
      (select count(*) from public.profiles) +
      (select count(*) from public.artist_members) +
      (select count(*) from public.subscriptions) +
      (select count(*) from public.payment_events) +
      (select count(*) from private.payment_mandates) +
      (select count(*) from private.billing_obligations) +
      (select count(*) from private.payment_attempts) +
      (select count(*) from private.payment_event_verifications) +
      (select count(*) from public.messages) +
      (select count(*) from public.message_media) +
      (select count(*) from public.message_reads) +
      (select count(*) from public.replies) +
      (select count(*) from private.message_policy) +
      (select count(*) from public.posts) +
      (select count(*) from public.comments) +
      (select count(*) from public.post_likes) +
      (select count(*) from public.reports) +
      (select count(*) from private.community_policy) +
      (select count(*) from private.community_rate_limits) +
      (select count(*) from public.post_images) +
      (select count(*) from public.community_moderation_log) +
      (select count(*) from public.schedules) +
      (select count(*) from public.schedule_notification_optouts) +
      (select count(*) from public.content_calendar) +
      (select count(*) from public.calendar_audit_log) +
      (select count(*) from private.point_policy) +
      (select count(*) from private.point_ledger) +
      (select count(*) from private.notification_policy) +
      (select count(*) from private.notification_preferences) +
      (select count(*) from private.push_subscriptions) +
      (select count(*) from private.notification_jobs) +
      (select count(*) from private.notification_attempts) +
      (select count(*) from private.analytics_policy) +
      (select count(*) from private.analytics_consents) +
      (select count(*) from private.analytics_events) +
      (select count(*) from private.settlement_policies) +
      (select count(*) from private.settlement_source_versions) +
      (select count(*) from public.settlements) +
      (select count(*) from public.settlement_weekly_stats) +
      (select count(*) from private.settlement_event_sources) +
      (select count(*) from private.settlement_message_sources) +
      (select count(*) from private.settlement_adjustments) +
      (select count(*) from storage.objects) +
      (select count(*) from public.artists where id not in (
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002'));`),
    '0',
    'Use a freshly reset disposable local database with fictional seeds only; this test resets it afterward.',
  );
  shouldReset = true;
  await testConcurrency(db);
  console.info(
    'All eighteen PostgreSQL multi-session settlement races passed.',
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.all([...clients].map((client) => client.close()));
  if (shouldReset) {
    try {
      console.info(
        'Restoring the disposable local database after committed fixtures.',
      );
      execFileSync(localCli, ['db', 'reset', '--local'], { stdio: 'inherit' });
    } catch (error) {
      console.error(
        'Local fixture cleanup failed. Run npm run db:reset before using this disposable database again.',
        error,
      );
      process.exitCode = 1;
    }
  }
}
