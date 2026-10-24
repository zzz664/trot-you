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
    this.label = `enrollment-concurrency-${label}`;
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
    const marker = `ENROLLMENT_TEST_DONE_${++commandSequence}`;
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
const envelope = `'{"version":"fixture-v1","iv":"AAAAAAAAAAAAAAAA","tag":"AAAAAAAAAAAAAAAAAAAAAA","ciphertext":"AA"}'::jsonb`;
let checks = 0;
function pass(message) {
  checks += 1;
  console.info(`PASS: ${message}`);
}

async function setup(db) {
  const fanId = uuid();
  const termsId = uuid();
  const privacyId = uuid();
  const policyId = uuid();
  const replacementId = uuid();
  await db.query(`
    insert into auth.users(id,email,raw_user_meta_data) values('${fanId}','enrollment-race@example.invalid','{}');
    insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
      ('${termsId}','terms','Fictional terms','Disposable concurrency fixture only.',now(),now()),
      ('${privacyId}','privacy','Fictional privacy','Disposable concurrency fixture only.',now(),now());
    insert into private.profile_onboarding_policy values(true,'${uuid()}',now(),2,10,
      array['금지단어'],'${termsId}','${privacyId}',null);
    update public.profiles set font_selected_at=now(),call_name='허구구독팬',age_self_attested_at=now(),
      profile_completed_at=now(),onboarding_completed_at=now() where id='${fanId}';
    insert into private.profile_policy_acceptances(user_id,kind,version,accepted_at)
      select '${fanId}',kind,version,now() from private.onboarding_documents;
    insert into private.checkout_policies values
      ('${policyId}','허구 구독 정책','실제 운영과 무관한 경합 전용 정책입니다.',7200,1200,now(),now(),'utc_monthly_clamped','taxable_krw'),
      ('${replacementId}','허구 변경 정책','실제 운영과 무관한 경합 전용 변경 정책입니다.',7300,1300,now(),now(),'utc_monthly_clamped','taxable_krw');
    insert into private.checkout_policy_current values(true,'${policyId}');
    insert into private.notification_policy values(true,'fixture-policy','fixture-consent',true,1,1,5,60);
    insert into private.notification_preferences(user_id,webpush_enabled,billing) values('${fanId}',true,true);
    insert into private.push_subscriptions(user_id,endpoint,p256dh,auth,consent_version,consented_at)
      values('${fanId}','https://push.example.invalid/enrollment-race',repeat('A',87),repeat('A',22),'fixture-consent',now());
  `);
  return { fanId, policyId, replacementId };
}

async function fixture(db, f, provider = 'toss', start = true) {
  const artistId = uuid();
  const slug = `enrollment-race-${artistId}`;
  await db.query(`insert into public.artists(id,slug,name,grade,status)
    values('${artistId}','${slug}','허구 첫 결제 경합 가수','B','active');`);
  const sessionId = await db.query(
    `begin; ${service(`select session_id from public.checkout_prepare_session(
    '${f.fanId}','${slug}','${provider}','test','${uuid()}',repeat('a',64),'${f.policyId}',true);`)} commit;`,
  );
  const startSql = `public.enrollment_start('${f.fanId}','${sessionId}',repeat('a',64),repeat('b',64),repeat('c',64),'fixture-merchant')`;
  const c = {
    ...f,
    artistId,
    slug,
    sessionId,
    startSql,
    claim(stage, accepted = false) {
      return `public.enrollment_claim('${f.fanId}','${sessionId}',repeat('a',64),repeat('b',64),
        '${stage}',${accepted},'${f.policyId}',1200,now(),now()+interval '1 month')`;
    },
    capture: `public.enrollment_capture('${f.fanId}','${sessionId}',repeat('a',64),repeat('b',64),repeat('c',64),${envelope})`,
    cancel: `public.enrollment_cancel('${f.fanId}','${sessionId}',repeat('a',64),repeat('b',64))`,
  };
  if (start)
    c.data = JSON.parse(
      await db.query(`begin; ${service(`select ${startSql};`)} commit;`),
    );
  return c;
}
async function call(db, expression) {
  return JSON.parse(
    await db.query(`begin; ${service(`select ${expression};`)} commit;`),
  );
}
async function registerToss(db, c) {
  await call(db, c.capture);
  const exchange = await call(db, c.claim('exchange'));
  assert.equal(exchange.dispatch, true);
  await call(
    db,
    `public.enrollment_record_credential('${c.fanId}','${c.sessionId}','${exchange.lease_token}',${envelope})`,
  );
}
async function registerKakao(db, c) {
  const ready = await call(db, c.claim('ready'));
  assert.equal(ready.dispatch, true);
  await call(
    db,
    `public.enrollment_record_ready('${c.fanId}','${c.sessionId}','${ready.lease_token}','TID_${c.artistId}',${envelope})`,
  );
  await call(db, c.capture);
}
async function testConcurrency(db) {
  const f = await setup(db);
  const start = await fixture(db, f, 'toss', false);
  const duplicate = await race(
    db,
    'same-start',
    service(`select ${start.startSql}->>'mandate_id';`),
    service(`select ${start.startSql}->>'mandate_id';`),
  );
  assert.equal(duplicate.following.error, undefined);
  assert.equal(duplicate.winner, duplicate.following.value);
  assert.equal(
    await db.query(
      `select count(*) from private.subscription_enrollments where session_id='${start.sessionId}';`,
    ),
    '1',
  );
  pass(
    'concurrent start creates one pending subscription and one mandate reference',
  );

  const state = await race(
    db,
    'callback-state',
    service(`select ${start.startSql}->>'mandate_id';`),
    service(
      `select public.enrollment_start('${f.fanId}','${start.sessionId}',repeat('a',64),repeat('b',64),repeat('d',64),'fixture-merchant');`,
    ),
  );
  assert.match(
    state.following.error?.message ?? '',
    /ENROLLMENT_BINDING_INVALID/,
  );
  pass('concurrent start cannot rotate callback binding or adopt a new nonce');

  const callback = await race(
    db,
    'same-callback',
    service(`select ${start.capture}->>'public_status';`),
    service(`select ${start.capture}->>'public_status';`),
  );
  assert.equal(callback.winner, 'awaiting_confirmation');
  assert.equal(callback.following.value, 'awaiting_confirmation');
  assert.equal(
    await db.query('select count(*) from private.payment_attempts;'),
    '0',
  );
  pass('repeated callback stores authorization once without any money attempt');

  const exchange = await race(
    db,
    'same-exchange',
    service(`select ${start.claim('exchange')}->>'dispatch';`),
    service(`select ${start.claim('exchange')}->>'dispatch';`),
  );
  assert.equal(exchange.winner, 'true');
  assert.equal(exchange.following.value, 'false');
  pass('concurrent Toss exchange permits one transport dispatch');
  const exchangeLease = await db.query(
    `select lease_token from private.subscription_enrollments where session_id='${start.sessionId}';`,
  );
  await call(
    db,
    `public.enrollment_record_credential('${f.fanId}','${start.sessionId}','${exchangeLease}',${envelope})`,
  );

  const charge = await race(
    db,
    'same-charge',
    service(`select ${start.claim('charge', true)}->>'dispatch';`),
    service(`select ${start.claim('charge', true)}->>'dispatch';`),
  );
  assert.equal(charge.winner, 'true');
  assert.equal(charge.following.value, 'false');
  assert.equal(
    await db.query('select count(*) from private.payment_attempts;'),
    '1',
  );
  pass('double-confirm creates one stable first-charge order and lease');

  const approved = await db.query('select clock_timestamp();');
  const finalize = `public.enrollment_finalize('${f.fanId}','${start.sessionId}','ACTION_RACE','PAYMENT_RACE',1200,'KRW','${approved}','${uuid()}',null)`;
  const finalization = await race(
    db,
    'same-success',
    service(`select ${finalize}->>'payment_event_id';`),
    service(`select ${finalize}->>'payment_event_id';`),
  );
  assert.equal(finalization.following.error, undefined);
  assert.equal(finalization.winner, finalization.following.value);
  assert.equal(
    await db.query('select count(*) from public.payment_events;'),
    '1',
  );
  assert.equal(
    await db.query(
      "select count(*) from private.notification_jobs where source_kind='payment';",
    ),
    '1',
  );
  pass(
    'concurrent success commits exactly one ledger, paid period and outbox job',
  );

  const canceled = await fixture(db, f);
  await registerToss(db, canceled);
  const cancelFirst = await race(
    db,
    'cancel-before-charge',
    service(`select ${canceled.cancel}->>'public_status';`),
    service(`select ${canceled.claim('charge', true)}->>'dispatch';`),
  );
  assert.equal(cancelFirst.winner, 'canceled');
  assert.equal(cancelFirst.following.value, 'false');
  pass(
    'cancellation-first prevents a charge waiting for the same subscription',
  );

  const charging = await fixture(db, f);
  await registerToss(db, charging);
  const chargeFirst = await race(
    db,
    'charge-before-cancel',
    service(`select ${charging.claim('charge', true)}->>'dispatch';`),
    service(`select ${charging.cancel};`),
  );
  assert.equal(chargeFirst.winner, 'true');
  assert.match(
    chargeFirst.following.error?.message ?? '',
    /ENROLLMENT_CANNOT_CANCEL/,
  );
  pass('charge-first cannot be erased by a concurrent dismissal');

  const restricted = await fixture(db, f);
  await call(db, restricted.capture);
  const restriction = await race(
    db,
    'restrict-before-exchange',
    `update public.profiles set is_restricted=true where id='${f.fanId}';`,
    service(`select ${restricted.claim('exchange')};`),
  );
  assert.match(
    restriction.following.error?.message ?? '',
    /DISCOVERY_FORBIDDEN/,
  );
  await db.query(
    `update public.profiles set is_restricted=false where id='${f.fanId}';`,
  );
  pass('restriction committed during lock wait prevents provider exchange');

  const rotated = await fixture(db, f);
  await registerToss(db, rotated);
  const rotation = await race(
    db,
    'rotate-before-charge',
    `update private.checkout_policy_current set policy_version='${f.replacementId}';`,
    service(`select ${rotated.claim('charge', true)};`),
  );
  assert.match(
    rotation.following.error?.message ?? '',
    /CHECKOUT_POLICY_CHANGED/,
  );
  await db.query(
    `update private.checkout_policy_current set policy_version='${f.policyId}';`,
  );
  pass('policy rotation observed after row wait denies stale-price charge');

  const expiring = await fixture(db, f);
  await call(db, expiring.capture);
  // The first transaction holds only the commercial-policy row. The claimant
  // samples an initial clock before blocking there, so this specifically proves
  // that authorization expiry is checked using a fresh post-policy-wait clock.
  await db.query(
    `update private.subscription_enrollments set callback_expires_at=clock_timestamp()+interval '8 seconds' where session_id='${expiring.sessionId}';`,
  );
  const expiry = await race(
    db,
    'auth-expires-at-policy',
    `select 1 from private.checkout_policy_current for update;`,
    service(`select ${expiring.claim('exchange')};`),
    async () => {
      const remaining = Number(
        await db.query(`select ceil(extract(epoch from
        callback_expires_at-clock_timestamp())*1000)::integer from private.subscription_enrollments
        where session_id='${expiring.sessionId}';`),
      );
      assert.ok(
        remaining > 0,
        'The claimant must block on policy before authorization expiry.',
      );
      await delay(remaining + 50);
    },
  );
  assert.match(
    expiry.following.error?.message ?? '',
    /ENROLLMENT_AUTHORIZATION_EXPIRED/,
  );
  pass(
    'authorization expiring during policy-row wait never dispatches with a stale clock',
  );

  const lost = await fixture(db, f);
  await call(db, lost.capture);
  await call(db, lost.claim('exchange'));
  const leaseExpiry = await race(
    db,
    'lease-expires-waiting',
    `update private.subscription_enrollments set lease_expires_at=clock_timestamp()+interval '1 second' where session_id='${lost.sessionId}';`,
    service(`select ${lost.claim('exchange')}->>'dispatch';`),
    async () => {
      await delay(1200);
    },
  );
  assert.equal(leaseExpiry.following.value, 'false');
  assert.equal(
    await db.query(
      `select state from private.subscription_enrollments where session_id='${lost.sessionId}';`,
    ),
    'manual_review',
  );
  pass(
    'expired in-flight lease becomes manual review and is never re-dispatched',
  );

  const kakao = await fixture(db, f, 'kakaopay');
  const ready = await race(
    db,
    'same-kakao-ready',
    service(`select ${kakao.claim('ready')}->>'dispatch';`),
    service(`select ${kakao.claim('ready')}->>'dispatch';`),
  );
  assert.equal(ready.winner, 'true');
  assert.equal(ready.following.value, 'false');
  pass(
    'Kakao ready has one application dispatch without an invented idempotency guarantee',
  );
  const readyLease = await db.query(
    `select lease_token from private.subscription_enrollments where session_id='${kakao.sessionId}';`,
  );
  await call(
    db,
    `public.enrollment_record_ready('${f.fanId}','${kakao.sessionId}','${readyLease}','TID_${kakao.artistId}',${envelope})`,
  );
  await call(db, kakao.capture);
  const approve = await race(
    db,
    'same-kakao-approve',
    service(`select ${kakao.claim('approve', true)}->>'dispatch';`),
    service(`select ${kakao.claim('approve', true)}->>'dispatch';`),
  );
  assert.equal(approve.winner, 'true');
  assert.equal(approve.following.value, 'false');
  pass('Kakao approve includes first charge and can be claimed only once');

  const approveLease = await db.query(
    `select lease_token from private.subscription_enrollments where session_id='${kakao.sessionId}';`,
  );
  await call(
    db,
    `public.enrollment_record_outcome('${f.fanId}','${kakao.sessionId}','${approveLease}','unknown',null)`,
  );
  await db.query(`update private.checkout_sessions set created_at=clock_timestamp()-interval '1 hour',
    expires_at=clock_timestamp()-interval '59 minutes' where id='${kakao.sessionId}';`);
  const unknown = await race(
    db,
    'unknown-blocks-new-provider',
    `select 1 from public.subscriptions where id='${kakao.data.subscription_id}' for update;`,
    service(
      `select session_id from public.checkout_prepare_session('${f.fanId}','${kakao.slug}','toss','test','${uuid()}',repeat('d',64),'${f.policyId}',true);`,
    ),
  );
  assert.match(
    unknown.following.error?.message ?? '',
    /CHECKOUT_SUBSCRIPTION_EXISTS/,
  );
  assert.equal((await call(db, kakao.claim('approve', true))).dispatch, false);
  pass('unknown response blocks a new provider even after checkout expires');

  const cancelCallback = await fixture(db, f);
  const lateCallback = await race(
    db,
    'cancel-before-callback',
    service(`select ${cancelCallback.cancel}->>'public_status';`),
    service(`select ${cancelCallback.capture};`),
  );
  assert.match(
    lateCallback.following.error?.message ?? '',
    /CHECKOUT_SESSION_REPLAY/,
  );
  pass('callback waiting behind cancellation cannot resurrect enrollment');

  const evidence = await fixture(db, f, 'kakaopay');
  await registerKakao(db, evidence);
  const evidenceApprove = await call(db, evidence.claim('approve', true));
  await call(
    db,
    `public.enrollment_record_outcome('${f.fanId}','${evidence.sessionId}','${evidenceApprove.lease_token}','unknown',null)`,
  );
  const evidenceAt = await db.query('select clock_timestamp();');
  const reconcile = `public.enrollment_record_reconciliation('${f.fanId}','${evidence.sessionId}',
    'AID_${evidence.artistId}','TID_${evidence.artistId}',1200,'KRW','${evidenceAt}','${uuid()}')`;
  const reconciliation = await race(
    db,
    'same-kakao-reconciliation',
    service(`select ${reconcile}->>'public_status';`),
    service(`select ${reconcile}->>'public_status';`),
  );
  assert.equal(reconciliation.winner, 'manual_review');
  assert.equal(reconciliation.following.value, 'manual_review');
  assert.equal(
    await db.query(
      `select count(*) from private.enrollment_reconciliations where session_id='${evidence.sessionId}';`,
    ),
    '1',
  );
  assert.equal(
    await db.query('select count(*) from public.payment_events;'),
    '1',
  );
  pass(
    'concurrent verified Kakao recovery without SID stores one manual-review record, never another charge',
  );
  const abandoned = await fixture(db, f);
  await call(db, abandoned.capture);
  await db.query(`update private.checkout_sessions set created_at=clock_timestamp()-interval '1 hour',
    expires_at=clock_timestamp()-interval '59 minutes' where id='${abandoned.sessionId}';`);
  const cleanupFirst = await race(
    db,
    'abandon-before-claim',
    service(
      `select public.enrollment_abandon_expired('${f.fanId}','${abandoned.slug}');`,
    ),
    service(`select ${abandoned.claim('exchange')}->>'dispatch';`),
  );
  assert.equal(cleanupFirst.winner, 't');
  assert.equal(cleanupFirst.following.value, 'false');
  pass(
    'expired-idle abandonment wins before claim and never reuses old authorization',
  );

  const cleanupBlocked = await fixture(db, f);
  await registerToss(db, cleanupBlocked);
  await db.query(`update private.checkout_sessions set expires_at=clock_timestamp()+interval '1 second'
    where id='${cleanupBlocked.sessionId}';`);
  const claimFirst = await race(
    db,
    'claim-before-abandon',
    service(`select ${cleanupBlocked.claim('charge', true)}->>'dispatch';`),
    service(
      `select public.enrollment_abandon_expired('${f.fanId}','${cleanupBlocked.slug}');`,
    ),
    async () => {
      await delay(1200);
    },
  );
  assert.equal(claimFirst.winner, 'true');
  assert.equal(claimFirst.following.value, 'f');
  assert.equal(
    await db.query(
      `select state from private.subscription_enrollments where session_id='${cleanupBlocked.sessionId}';`,
    ),
    'processing',
  );
  pass(
    'claim-first remains unresolved after expiry and cannot be abandoned into another charge',
  );
}

try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(`select
      (select count(*) from auth.users) + (select count(*) from public.profiles) +
      (select count(*) from public.subscriptions) + (select count(*) from public.payment_events) +
      (select count(*) from private.checkout_sessions) + (select count(*) from private.checkout_policies) +
      (select count(*) from private.subscription_enrollments) + (select count(*) from private.enrollment_credentials) +
      (select count(*) from private.enrollment_reconciliations) + (select count(*) from private.profile_onboarding_policy) +
      (select count(*) from private.notification_policy) + (select count(*) from private.onboarding_documents) +
      (select count(*) from public.artists where id not in (
        '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'));`),
    '0',
    'Use a freshly reset disposable local database; these committed fictional fixtures are reset afterward.',
  );
  shouldReset = true;
  await testConcurrency(db);
  assert.equal(checks, 19);
  console.info(
    `All ${checks} PostgreSQL multi-session enrollment concurrency checks passed.`,
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
        'Local fixture cleanup failed. Run npm run db:reset before reusing this disposable database.',
        error,
      );
      process.exitCode = 1;
    }
  }
}
