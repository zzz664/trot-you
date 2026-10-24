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
    this.label = `billing-concurrency-${label}`;
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
    const marker = `BILLING_TEST_DONE_${++commandSequence}`;
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

// Test cases and RPC inputs are defined below; all provider identities are
// fictional test-namespace references, never secret billing keys or SIDs.
const uuid = () => crypto.randomUUID();
const service = (sql) => `set role service_role; ${sql} reset role;`;
const localCli = fileURLToPath(
  new URL('../node_modules/.bin/supabase', import.meta.url),
);
let shouldReset = false;

async function fixture(db, userId, provider = 'toss', periodSeconds = null) {
  const artistId = uuid();
  await db.query(`
    insert into public.artists(id, slug, name, grade, status)
    values ('${artistId}', 'concurrency-${artistId}', 'Fictional concurrency artist', 'B', 'active');
  `);
  const subscriptionId = await db.query(
    service(
      `select public.billing_open_subscription('${userId}', '${artistId}', '${provider}');`,
    ),
  );
  await db.query(
    service(`select public.billing_register_mandate(
      '${subscriptionId}', 'test', 'fictional-concurrency-merchant', '${uuid()}', '${uuid()}', 'fixture-consent-v1');`),
  );
  const periodStart = await db.query(
    "select statement_timestamp() - interval '1 second';",
  );
  const periodEnd = await db.query(
    periodSeconds === null
      ? "select statement_timestamp() + interval '1 month';"
      : `select statement_timestamp() + make_interval(secs => ${periodSeconds});`,
  );
  const obligationId = await db.query(
    service(`select public.billing_prepare_obligation(
      '${subscriptionId}', '${periodStart}', '${periodEnd}', 1000, true,
      'fixture-price-v1', 259200, 86400, 3);`),
  );
  const attemptId = await db.query(
    service(`select public.billing_prepare_attempt('${obligationId}');`),
  );
  return { subscriptionId, obligationId, attemptId, periodStart, periodEnd };
}

function claimSql(f) {
  return `select public.billing_claim_attempt('${f.attemptId}', 120);`;
}

function chargeSql(f, approvedAt, actionId) {
  return `select public.billing_finalize_charge(
    '${f.attemptId}', '${actionId}', 1000, 'KRW', '${approvedAt}', '${uuid()}');`;
}

function refundSql(eventId, refundedAt, actionId, amount) {
  return `select public.billing_record_refund(
    '${eventId}', '${actionId}', ${amount}, 'KRW', '${refundedAt}', '${uuid()}');`;
}

function lockSubscription(f) {
  return `select id from public.subscriptions where id = '${f.subscriptionId}' for update;`;
}

async function race(db, label, lockSql, firstSql, secondSql, onBlocked) {
  const first = await session(`${label}-first`);
  const second = await session(`${label}-second`);
  try {
    await first.query(`begin; ${lockSql}`);
    // Attach rejection handling before waiting: an expected SQL failure must not
    // become an unhandled promise rejection while the winning transaction runs.
    const following = second
      .query(`begin; set local role service_role; ${secondSql} commit;`)
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    await waitForBlock(db, second, first);
    if (onBlocked) await onBlocked(second);
    const winner = await first.query(
      `set local role service_role; ${firstSql} commit;`,
    );
    return { winner, following: await following };
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
}

async function testConcurrency(db) {
  const userId = uuid();
  await db.query(`
    insert into auth.users(id, email, raw_user_meta_data)
    values ('${userId}', 'billing-concurrency@example.invalid', '{}');
    update public.profiles set call_name = 'Fictional fan',
      onboarding_completed_at = statement_timestamp() where id = '${userId}';
  `);

  // 1. Two real sessions contend for the same persisted attempt. Only one
  // receives a dispatch lease; the loser must not call any provider.
  const claimed = await fixture(db, userId);
  const doubleClaim = await race(
    db,
    'claim',
    lockSubscription(claimed),
    claimSql(claimed),
    claimSql(claimed),
  );
  assert.ok(JSON.parse(doubleClaim.winner).lease_token);
  assert.equal(doubleClaim.following.error, undefined);
  assert.equal(doubleClaim.following.value, '');
  assert.equal(
    await db.query(`select count(*) from private.payment_attempts
      where obligation_id = '${claimed.obligationId}' and state = 'inflight';`),
    '1',
  );
  console.info('PASS: simultaneous claims issue exactly one dispatch lease');

  // 2. Duplicate verified approvals are serialized, with exactly one immutable
  // charge and exactly one entitlement-period update, not two months of access.
  const approvedAt = await db.query('select statement_timestamp();');
  const finalize = chargeSql(claimed, approvedAt, 'fictional-charge-race');
  const finalization = await race(
    db,
    'finalize',
    lockSubscription(claimed),
    finalize,
    finalize,
  );
  assert.equal(finalization.following.error, undefined);
  assert.equal(finalization.winner, finalization.following.value);
  assert.match(finalization.winner, /^[0-9a-f-]{36}$/);
  assert.equal(
    await db.query(`select count(*) from public.payment_events
      where subscription_id = '${claimed.subscriptionId}' and kind = 'charge';`),
    '1',
  );
  assert.equal(
    await db.query(`select current_period_end = '${claimed.periodEnd}'::timestamptz
      from public.subscriptions where id = '${claimed.subscriptionId}';`),
    't',
  );
  console.info(
    'PASS: concurrent approval replay creates one charge and period',
  );

  // 3. Cancellation wins the serialization point: a waiting worker gets no
  // dispatch lease, even though it prepared the attempt before cancellation.
  const canceled = await fixture(db, userId, 'kakaopay');
  const cancelFirst = await race(
    db,
    'cancel-first',
    lockSubscription(canceled),
    `select (public.cancel_subscription('${canceled.subscriptionId}')).status;`,
    claimSql(canceled),
  );
  assert.equal(cancelFirst.winner, 'canceled');
  assert.equal(cancelFirst.following.error, undefined);
  assert.equal(cancelFirst.following.value, '');
  assert.equal(
    await db.query(
      `select state from private.billing_obligations where id = '${canceled.obligationId}';`,
    ),
    'void',
  );
  console.info('PASS: cancellation winning the lock prevents dispatch');

  // 4. Claim wins instead: cancellation cannot pretend the external result is
  // known. A late verified charge remains recordable, without restarting billing.
  const late = await fixture(db, userId, 'kakaopay');
  const claimFirst = await race(
    db,
    'claim-first',
    lockSubscription(late),
    claimSql(late),
    `select (public.cancel_subscription('${late.subscriptionId}')).status;`,
  );
  assert.ok(JSON.parse(claimFirst.winner).lease_token);
  assert.equal(claimFirst.following.error, undefined);
  assert.equal(claimFirst.following.value, 'canceled');
  const lateApproval = await db.query('select statement_timestamp();');
  await db.query(
    service(chargeSql(late, lateApproval, 'fictional-late-charge')),
  );
  assert.equal(
    await db.query(`select status = 'canceled' and next_billing_at is null
      and current_period_end = '${late.periodEnd}'::timestamptz
      from public.subscriptions where id = '${late.subscriptionId}';`),
    't',
  );
  console.info(
    'PASS: claim-before-cancel preserves late money without renewal',
  );

  // 5. Concurrent partial refunds cannot both spend the same remaining amount.
  // The original event row is the shared lock, including for different action IDs.
  const chargeId = finalization.winner;
  const refundedAt = await db.query('select statement_timestamp();');
  const partial = await race(
    db,
    'refund-cap',
    `select id from public.payment_events where id = '${chargeId}' for update;`,
    refundSql(chargeId, refundedAt, 'fictional-refund-700', 700),
    refundSql(chargeId, refundedAt, 'fictional-refund-other-700', 700),
  );
  assert.match(partial.winner, /^[0-9a-f-]{36}$/);
  assert.match(partial.following.error?.message ?? '', /REFUND_EXCEEDS_CHARGE/);
  assert.equal(
    await db.query(`select sum(amount_krw) from public.payment_events
      where original_event_id = '${chargeId}';`),
    '-700',
  );
  assert.equal(
    await db.query(`select count(*) from private.payment_event_verifications
      where provider_action_id = 'fictional-refund-other-700';`),
    '0',
  );
  console.info(
    'PASS: simultaneous partial refunds cannot exceed original charge',
  );

  // 6. Replaying the final partial refund concurrently returns the same ledger
  // identity; it does not reject a legitimate duplicate as an over-refund.
  const finalRefundAt = await db.query('select statement_timestamp();');
  const remaining = refundSql(
    chargeId,
    finalRefundAt,
    'fictional-refund-remaining-300',
    300,
  );
  const replay = await race(
    db,
    'refund-replay',
    `select id from public.payment_events where id = '${chargeId}' for update;`,
    remaining,
    remaining,
  );
  assert.equal(replay.following.error, undefined);
  assert.equal(replay.winner, replay.following.value);
  assert.equal(
    await db.query(`select sum(amount_krw) from public.payment_events
      where original_event_id = '${chargeId}';`),
    '-1000',
  );
  assert.equal(
    await db.query(`select count(*) from public.payment_events
      where original_event_id = '${chargeId}';`),
    '2',
  );
  console.info(
    'PASS: duplicate refund callback records the remaining refund once',
  );

  // 7. Dispatch eligibility must use the time AFTER row-lock acquisition. A
  // statement begun during grace cannot use its stale statement_timestamp to
  // acquire a dispatch lease after grace has expired while the statement waited.
  const short = await fixture(db, userId, 'toss', 10);
  await db.query(service(claimSql(short)));
  const shortApproval = await db.query('select statement_timestamp();');
  await db.query(
    service(chargeSql(short, shortApproval, 'fictional-short-period-charge')),
  );
  const renewalId = await db.query(
    service(`select public.billing_prepare_obligation(
      '${short.subscriptionId}', '${short.periodEnd}',
      '${short.periodEnd}'::timestamptz + interval '1 month', 6500, false,
      'fixture-renewal-v1', 6, 1, 3);`),
  );
  await db.query(`select pg_sleep(greatest(0, extract(epoch from
    '${short.periodEnd}'::timestamptz - clock_timestamp())) + 0.05);`);
  const failedAttempt = await db.query(
    service(`select public.billing_prepare_attempt('${renewalId}');`),
  );
  const failureLease = JSON.parse(
    await db.query(
      service(`select public.billing_claim_attempt('${failedAttempt}', 120);`),
    ),
  );
  await db.query(
    service(`select public.billing_record_attempt_outcome(
      '${failedAttempt}', '${failureLease.lease_token}', 'failed', '${uuid()}');`),
  );
  const retryAt = await db.query(`select next_attempt_at
    from private.billing_obligations where id = '${renewalId}';`);
  await db.query(`select pg_sleep(greatest(0, extract(epoch from
    '${retryAt}'::timestamptz - clock_timestamp())) + 0.05);`);
  const graceAttempt = await db.query(
    service(`select public.billing_prepare_attempt('${renewalId}');`),
  );
  const graceEnds = await db.query(`select grace_ends_at
    from public.subscriptions where id = '${short.subscriptionId}';`);
  assert.equal(
    await db.query(`select '${graceEnds}'::timestamptz > clock_timestamp();`),
    't',
    'The competing claim must begin before grace expires.',
  );
  const expiredWhileWaiting = await race(
    db,
    'grace-expiry',
    lockSubscription(short),
    `select pg_sleep(greatest(0, extract(epoch from
      '${graceEnds}'::timestamptz - clock_timestamp())) + 0.05);`,
    `select public.billing_claim_attempt('${graceAttempt}', 120);`,
    async (waiting) => {
      assert.equal(
        await db.query(`select query_start < '${graceEnds}'::timestamptz
          from pg_stat_activity where application_name = '${waiting.label}';`),
        't',
        'The blocked claim statement actually started before grace expired.',
      );
    },
  );
  assert.equal(expiredWhileWaiting.following.error, undefined);
  assert.equal(expiredWhileWaiting.following.value, '');
  assert.equal(
    await db.query(
      `select state from private.payment_attempts where id = '${graceAttempt}';`,
    ),
    'created',
  );
  console.info('PASS: a claim blocked past grace expiry cannot dispatch');
}

try {
  assertLocalDocker();
  const db = await session('observer');
  // This guard must pass before any fixture mutation or reset authorization.
  // Refuse populated local DBs instead of deleting a developer's existing data.
  assert.equal(
    await db.query(`select
      (select count(*) from auth.users) +
      (select count(*) from public.profiles) +
      (select count(*) from public.subscriptions) +
      (select count(*) from public.payment_events) +
      (select count(*) from public.artists where id not in (
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002'));`),
    '0',
    'Use a freshly reset disposable local database with fictional seeds only; this test resets it afterward.',
  );
  shouldReset = true;
  await testConcurrency(db);
  console.info(
    'All seven PostgreSQL multi-session billing concurrency checks passed.',
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.all([...clients].map((client) => client.close()));
  if (shouldReset) {
    // No trigger bypass/delete API is introduced to erase immutable fixtures.
    // Only the proven-empty local CLI database is reset, including on failure.
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
