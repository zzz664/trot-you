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
    this.label = `reconciliation-concurrency-${label}`;
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
    const marker = `RECONCILIATION_TEST_DONE_${++commandSequence}`;
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
    const backendPid = await this.query(`
      set application_name = '${this.label}';
      set statement_timeout = '${timeoutMs}ms';
      set lock_timeout = '${timeoutMs}ms';
      set timezone = 'UTC';
      select pg_backend_pid();
    `);
    // application_name is shorter than NAMEDATALEN (at most 63 bytes normally),
    // so long descriptive race labels are not reliable session identities.
    // Observe the actual live connection by its database-assigned backend PID.
    assert.match(
      backendPid,
      /^[1-9][0-9]*$/,
      'Expected one real PostgreSQL backend PID.',
    );
    this.backendPid = Number(backendPid);
    assert.ok(
      Number.isSafeInteger(this.backendPid),
      'Expected a safe backend PID.',
    );
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
        where waiting.pid = ${waiting.backendPid}
          and blocking.pid = ${blocking.backendPid}
          and waiting.wait_event_type = 'Lock'
          and blocking.pid = any(pg_blocking_pids(waiting.pid))
      );
    `);
    if (result === 't') return;
    await delay(25);
  }
  throw new Error(`${waiting.label} never blocked on ${blocking.label}`);
}

// Only fictional local identity/content rows; no provider calls or stored blobs.
const uuid = () => crypto.randomUUID();
const localCli = fileURLToPath(
  new URL('../node_modules/.bin/supabase', import.meta.url),
);
let shouldReset = false;

// Execute each transaction's actual operation, not a simulated in-memory race.
// The winner stays uncommitted until pg_blocking_pids proves the second operation
// is waiting for it. A timeout/deadlock is a failure, never an accepted outcome.
async function race(db, label, firstSql, secondSql, onBlocked) {
  const first = await session(`${label}-first`);
  const second = await session(`${label}-second`);
  try {
    const winner = await first.query(`begin; ${firstSql}`);
    const following = second.query(`begin; ${secondSql} commit;`).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await waitForBlock(db, second, first);
    if (onBlocked) await onBlocked(second);
    await first.query('commit;');
    return { winner, following: await following };
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
}

const service = (sql) => `set local role service_role; ${sql}`;
let checks = 0;
function parsed(output) {
  return JSON.parse(output.split('\n').at(-1));
}
function pass(label) {
  checks += 1;
  console.info(`PASS: ${label}`);
}
async function setup(db) {
  const f = {
    fan: uuid(),
    admin: uuid(),
    policy: uuid(),
    refundPolicy: uuid(),
  };
  await db.query(`
    insert into auth.users(id,email,raw_user_meta_data) values
    ('${f.fan}','reconcile-race-fan@example.invalid','{}'),('${f.admin}','reconcile-race-admin@example.invalid','{}');
    update public.profiles set role='admin' where id='${f.admin}';
    insert into private.checkout_policies values('${f.policy}','Fictional checkout','Disposable race only',1000,1000,now(),now(),'utc_monthly_clamped','taxable_krw');
    insert into private.refund_policies values('${f.refundPolicy}','Fictional refund','Disposable race only','preserve_paid_access','taxable_krw',now(),now());
  `);
  return f;
}
async function fixture(db, f, kind = 'renewal') {
  const c = {
    ...f,
    kind,
    sid: uuid(),
    artist: uuid(),
    mandate: uuid(),
    obligation: uuid(),
    attempt: uuid(),
    caseId: uuid(),
    event: uuid(),
    request: uuid(),
  };
  await db.query(`
    insert into public.artists(id,slug,name,grade,status) values('${c.artist}','reconcile-${c.artist}','Fictional race artist','B','active');
    insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end,next_billing_at)
    values('${c.sid}','${f.fan}','${c.artist}','toss','active',now()-interval '1 month',now()-interval '1 month',now()-interval '1 day',now()+interval '29 days',now()+interval '29 days');
    insert into private.payment_mandates(id,subscription_id,provider,environment,merchant_account,provider_customer_ref,secure_credential_ref,consent_version)
    values('${c.mandate}','${c.sid}','toss','test','reconciliation-race','${uuid()}','${uuid()}','${f.policy}');
    insert into private.billing_obligations(id,subscription_id,mandate_id,period_start,period_end,amount_krw,is_initial,is_intro,price_version,grace_seconds,retry_seconds,max_retries,state,next_attempt_at)
    values('${c.obligation}','${c.sid}','${c.mandate}',now()-interval '1 hour',now()+interval '30 days',1000,false,false,'${f.policy}',0,1,0,'${kind === 'refund' ? 'settled' : 'open'}',now());
    insert into private.payment_attempts(id,obligation_id,ordinal,state,created_at) values('${c.attempt}','${c.obligation}',1,'${kind === 'refund' ? 'success' : 'unknown'}',now()-interval '1 hour');
    insert into private.renewal_attempts(attempt_id,provider_payment_id,next_query_at) values('${c.attempt}','PAYMENT_${c.attempt}',now()-interval '1 second');
  `);
  if (kind === 'refund')
    await db.query(`
    insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at)
    values('${c.event}','${c.sid}','charge',1000,'toss',now()-interval '1 hour',now()+interval '30 days',now()-interval '50 minutes');
    insert into private.payment_event_verifications(event_id,attempt_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
    values('${c.event}','${c.attempt}','toss','test','reconciliation-race','CHARGE_${c.attempt}','${uuid()}');
    insert into private.refund_requests(id,user_id,subscription_id,original_event_id,idempotency_key,amount_krw,reason,state,policy_version,authorized_by,decision_reason,decided_at,refunded_before_krw,next_query_at)
    values('${c.request}','${f.fan}','${c.sid}','${c.event}','${uuid()}',600,'Fictional refund','unknown','${f.refundPolicy}','${f.admin}','Fictional approval',now()-interval '40 minutes',0,now()-interval '1 second');
  `);
  await db.query(
    `insert into private.payment_reconciliation_cases(id,${kind === 'refund' ? 'refund_request_id' : 'renewal_attempt_id'}) values('${c.caseId}','${kind === 'refund' ? c.request : c.attempt}');`,
  );
  c.occurredAt = await db.query(
    `select date_trunc('second',now()-interval '10 minutes');`,
  );
  return c;
}
const claimSql = (c) =>
  `select public.reconciliation_claim('${c.caseId}',120);`;
const receiptSql = (c) =>
  `select public.reconciliation_receive_toss('test','reconciliation-race','${c.attempt}','PAYMENT_${c.attempt}','${c.kind === 'refund' ? 'PARTIAL_CANCELED' : 'DONE'}',1000,repeat('a',64));`;
const completeSql = (c, action = `ACTION_${c.attempt}`) =>
  `select public.reconciliation_complete('${c.caseId}','${c.token}','${action}','PAYMENT_${c.attempt}',${c.kind === 'refund' ? 600 : 1000},'KRW','${c.occurredAt}','${uuid()}');`;
async function claim(db, c) {
  const result = parsed(
    await db.query(`begin; ${service(claimSql(c))} commit;`),
  );
  assert.equal(result.dispatch, true);
  c.token = result.lease_token;
}
async function tests(db) {
  const f = await setup(db);
  {
    const c = await fixture(db, f);
    const result = await race(
      db,
      'receipt-duplicate',
      service(receiptSql(c)),
      service(receiptSql(c)),
    );
    assert.equal(result.following.error, undefined);
    assert.equal(parsed(result.winner).duplicate, false);
    assert.equal(parsed(result.following.value).duplicate, true);
    assert.equal(
      await db.query(
        `select count(*) from private.payment_provider_inbox where case_id='${c.caseId}';`,
      ),
      '1',
    );
    pass('concurrent duplicate notices store one semantic receipt');
  }
  for (const kind of ['renewal', 'refund']) {
    const c = await fixture(db, f, kind);
    const result = await race(
      db,
      `${kind}-single-query`,
      service(claimSql(c)),
      service(claimSql(c)),
    );
    assert.equal(result.following.error, undefined);
    assert.equal(parsed(result.winner).dispatch, true);
    assert.equal(parsed(result.following.value).dispatch, false);
    assert.equal(
      await db.query(
        `select query_attempts from private.payment_reconciliation_cases where id='${c.caseId}';`,
      ),
      '1',
    );
    pass(`${kind} duplicate workers share one query lease`);
  }
  for (const kind of ['renewal', 'refund']) {
    const c = await fixture(db, f, kind);
    const oldSql =
      kind === 'refund'
        ? `select public.refund_claim('${c.request}','${c.admin}',120);`
        : `select public.renewal_claim('${c.sid}','${c.mandate}',(select period_start from private.billing_obligations where id='${c.obligation}'),(select period_end from private.billing_obligations where id='${c.obligation}'),120);`;
    // Obtain immutable period text as postgres before entering service RPC; the
    // service role itself cannot SELECT private obligation tables.
    let statement = oldSql;
    if (kind === 'renewal') {
      const start = await db.query(
        `select period_start from private.billing_obligations where id='${c.obligation}';`,
      );
      const end = await db.query(
        `select period_end from private.billing_obligations where id='${c.obligation}';`,
      );
      statement = `select public.renewal_claim('${c.sid}','${c.mandate}','${start}','${end}',120);`;
    }
    const result = await race(
      db,
      `${kind}-old-worker`,
      service(statement),
      service(claimSql(c)),
    );
    assert.equal(result.following.error, undefined);
    assert.equal(parsed(result.winner).dispatch, true);
    assert.equal(parsed(result.following.value).dispatch, false);
    assert.equal(parsed(result.following.value).query_attempts, 1);
    pass(`${kind} old and reconciliation workers share budget and lease`);
  }
  for (const kind of ['renewal', 'refund']) {
    const c = await fixture(db, f, kind);
    await claim(db, c);
    await db.query(`begin; ${service(receiptSql(c))} commit;`);
    const result = await race(
      db,
      `${kind}-finalize-once`,
      service(completeSql(c)),
      service(completeSql(c)),
    );
    assert.equal(result.following.error, undefined);
    assert.equal(parsed(result.winner).state, 'processed');
    assert.equal(parsed(result.following.value).state, 'processed');
    assert.equal(
      parsed(result.winner).payment_event_id,
      parsed(result.following.value).payment_event_id,
    );
    assert.equal(
      await db.query(
        `select count(*) from public.payment_events where subscription_id='${c.sid}' and kind='${kind === 'refund' ? 'refund' : 'charge'}';`,
      ),
      '1',
    );
    assert.equal(
      await db.query(
        `select state from private.payment_provider_inbox where case_id='${c.caseId}';`,
      ),
      'processed',
    );
    pass(`${kind} financial result and processed inbox commit exactly once`);
  }
  {
    const c = await fixture(db, f);
    await claim(db, c);
    const result = await race(
      db,
      'different-action',
      service(completeSql(c)),
      service(completeSql(c, 'CONFLICTING_ACTION')),
    );
    assert.match(
      result.following.error?.message ?? '',
      /VERIFIED_RESULT_CONFLICT/,
    );
    assert.equal(
      await db.query(
        `select count(*) from public.payment_events where subscription_id='${c.sid}';`,
      ),
      '1',
    );
    pass('conflicting concurrent action cannot replace verified money');
  }
  {
    const c = await fixture(db, f);
    await claim(db, c);
    await db.query(`
      update private.payment_reconciliation_cases set next_query_at=now()-interval '1 second',lease_expires_at=now()-interval '1 second' where id='${c.caseId}';
      update private.renewal_attempts set next_query_at=now()-interval '1 second',query_lease_expires_at=now()-interval '1 second' where attempt_id='${c.attempt}';
    `);
    const result = await race(
      db,
      'replacement-lease',
      service(claimSql(c)),
      service(completeSql(c)),
    );
    assert.equal(parsed(result.winner).dispatch, true);
    assert.match(
      result.following.error?.message ?? '',
      /RECONCILIATION_LEASE_CONFLICT/,
    );
    assert.equal(
      await db.query(
        `select count(*) from public.payment_events where subscription_id='${c.sid}';`,
      ),
      '0',
    );
    assert.equal(
      await db.query(
        `select query_attempts from private.renewal_attempts where attempt_id='${c.attempt}';`,
      ),
      '2',
    );
    pass('new recovery claim serializes and rejects stale worker completion');
  }
  for (const cancelFirst of [true, false]) {
    const c = await fixture(db, f);
    await claim(db, c);
    const cancel = `select public.cancel_subscription('${c.sid}');`;
    const result = await race(
      db,
      cancelFirst ? 'cancel-before-reconcile' : 'reconcile-before-cancel',
      service(cancelFirst ? cancel : completeSql(c)),
      service(cancelFirst ? completeSql(c) : cancel),
    );
    assert.equal(result.following.error, undefined);
    assert.equal(
      await db.query(
        `select status::text||':'||(next_billing_at is null)::text from public.subscriptions where id='${c.sid}';`,
      ),
      'canceled:true',
    );
    assert.equal(
      await db.query(
        `select count(*) from public.payment_events where subscription_id='${c.sid}';`,
      ),
      '1',
    );
    pass(
      cancelFirst
        ? 'cancellation then recovery preserves paid money without reopening billing'
        : 'recovery then cancellation serializes without losing paid money',
    );
  }
  {
    // Cursor serialization is a real DB race, not an in-memory rotation test.
    await db.query(
      `update private.payment_reconciliation_cases set next_query_at=now()+interval '1 day';`,
    );
    const first = await fixture(db, f),
      second = await fixture(db, f);
    const result = await race(
      db,
      'fair-candidate-cursor',
      service('select public.reconciliation_candidates(1);'),
      service('select public.reconciliation_candidates(1);'),
    );
    assert.equal(result.following.error, undefined);
    const a = parsed(result.winner),
      b = parsed(result.following.value);
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.notEqual(a[0], b[0]);
    assert.deepEqual(
      new Set([a[0], b[0]]),
      new Set([first.caseId, second.caseId]),
    );
    assert.equal(
      await db.query(
        `select sum(query_attempts) from private.payment_reconciliation_cases where id in ('${first.caseId}','${second.caseId}');`,
      ),
      '0',
    );
    pass(
      'fair cursor prevents skipped-prefix starvation without consuming queries',
    );
  }
}
try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(
      `select (select count(*) from auth.users)+(select count(*) from public.subscriptions)+(select count(*) from private.payment_reconciliation_cases)+(select count(*) from private.payment_provider_inbox);`,
    ),
    '0',
    'Use a freshly reset disposable local database only.',
  );
  shouldReset = true;
  await tests(db);
  assert.equal(checks, 12);
  console.info(
    `All ${checks} PostgreSQL multi-session reconciliation concurrency checks passed.`,
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.all([...clients].map((client) => client.close()));
  if (shouldReset)
    try {
      execFileSync(localCli, ['db', 'reset', '--local'], { stdio: 'inherit' });
    } catch (error) {
      console.error(
        'Local fixture cleanup failed. Run npm run db:reset before reuse.',
        error,
      );
      process.exitCode = 1;
    }
}
