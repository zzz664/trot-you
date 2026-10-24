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
    this.label = `renewal-concurrency-${label}`;
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
  const f = {
    fanId: uuid(),
    policyId: uuid(),
    replacementId: uuid(),
    termsId: uuid(),
    privacyId: uuid(),
  };
  await db.query(`
    insert into auth.users(id,email,raw_user_meta_data) values('${f.fanId}','renewal-race@example.invalid','{}');
    insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
      ('${f.termsId}','terms','Fictional terms','Disposable race fixture only.',now(),now()),
      ('${f.privacyId}','privacy','Fictional privacy','Disposable race fixture only.',now(),now());
    insert into private.profile_onboarding_policy values(true,'${uuid()}',now(),2,10,array['금지단어'],'${f.termsId}','${f.privacyId}',null);
    update public.profiles set font_selected_at=now(),call_name='허구갱신팬',age_self_attested_at=now(),profile_completed_at=now(),onboarding_completed_at=now() where id='${f.fanId}';
    insert into private.profile_policy_acceptances(user_id,kind,version,accepted_at) select '${f.fanId}',kind,version,now() from private.onboarding_documents;
    insert into private.checkout_policies values
      ('${f.policyId}','허구 갱신 정책','운영과 무관한 경합 전용 정책입니다.',7200,1200,now(),now(),'utc_monthly_clamped','taxable_krw'),
      ('${f.replacementId}','허구 변경 정책','운영과 무관한 통지 필수 정책입니다.',7200,1200,now(),now(),'utc_monthly_clamped','taxable_krw');
    insert into private.checkout_policy_current values(true,'${f.policyId}');
    insert into private.renewal_policies values('${f.policyId}',259200,86400,3,false,0,now(),now()),('${f.replacementId}',259200,86400,3,true,86400,now(),now());
  `);
  return f;
}
async function call(db, expression) {
  const value = await db.query(
    `begin; ${service(`select ${expression};`)} commit;`,
  );
  return value ? JSON.parse(value) : null;
}
async function fixture(db, f, provider = 'toss', policyId = f.policyId) {
  const c = {
    ...f,
    artistId: uuid(),
    sid: uuid(),
    mid: uuid(),
    credentialId: uuid(),
    sessionId: uuid(),
    eventId: uuid(),
    provider,
    policyId,
  };
  await db.query(`
    insert into public.artists(id,slug,name,grade,status) values('${c.artistId}','renewal-${c.artistId}','허구 갱신 경합 가수','B','active');
    insert into public.subscriptions(id,user_id,artist_id,provider,status,intro_redeemed_at,first_started_at,episode_started_at,current_period_start,current_period_end,next_billing_at)
    select '${c.sid}','${f.fanId}','${c.artistId}','${provider}','active',anchor,anchor,anchor,anchor,due,due
    from (select anchor,private.enrollment_period_end(anchor,'utc_monthly_clamped') due from (select date_trunc('hour',clock_timestamp())-interval '1 month 1 hour' anchor) a) d;
    insert into private.payment_mandates(id,subscription_id,provider,environment,merchant_account,provider_customer_ref,secure_credential_ref,consent_version)
      values('${c.mid}','${c.sid}','${provider}','test','fixture-merchant','${uuid()}','${c.credentialId}','${policyId}');
    insert into public.payment_events(id,subscription_id,kind,amount_krw,currency,provider,period_start,period_end,occurred_at)
      select '${c.eventId}',id,'charge',1200,'KRW',provider,current_period_start,current_period_end,current_period_start from public.subscriptions where id='${c.sid}';
    insert into private.checkout_sessions(id,user_id,artist_id,provider,environment,idempotency_key,nonce_hash,policy_version,initial_price_krw,regular_price_krw,intro_eligible,created_at,expires_at)
      select '${c.sessionId}','${f.fanId}','${c.artistId}','${provider}','test','${uuid()}',repeat('a',64),'${policyId}',1200,7200,true,current_period_start,current_period_start+interval '30 minutes' from public.subscriptions where id='${c.sid}';
    insert into private.subscription_enrollments(session_id,user_id,artist_id,subscription_id,mandate_id,credential_ref,auth_session_hash,callback_state_hash,state,stage,payment_event_id)
      values('${c.sessionId}','${f.fanId}','${c.artistId}','${c.sid}','${c.mid}','${c.credentialId}',repeat('b',64),repeat('c',64),'succeeded','${provider === 'toss' ? 'charge' : 'approve'}','${c.eventId}');
    insert into private.enrollment_credentials(id,mandate_id,ciphertext) values('${c.credentialId}','${c.mid}',${envelope});
  `);
  c.read = `public.renewal_read('${c.sid}')`;
  c.data = await call(db, c.read);
  c.claim = `public.renewal_claim('${c.sid}','${c.mid}','${c.data.period_start}','${c.data.period_end}',120)`;
  c.cancel = `public.cancel_subscription('${c.sid}')`;
  return c;
}
async function claim(db, c) {
  c.dispatched = await call(db, c.claim);
  assert.equal(c.dispatched.dispatch, true);
  return c.dispatched;
}
function outcome(c, kind = 'unknown', retryable = false) {
  return `public.renewal_record_outcome('${c.dispatched.attempt_id}','${c.dispatched.lease_token}','${kind}',${kind === 'unknown' ? 'null' : `'${uuid()}'`},${retryable})`;
}
async function fail(db, c, retryable = true) {
  await claim(db, c);
  await call(db, outcome(c, 'failed', retryable));
}
async function due(db, c) {
  await db.query(`update private.billing_obligations set next_attempt_at=clock_timestamp()-interval '1 second' where subscription_id='${c.sid}';
    update public.subscriptions set next_billing_at=clock_timestamp()-interval '1 second' where id='${c.sid}';`);
}
async function queryDue(db, c) {
  await db.query(
    `update private.renewal_attempts set next_query_at=clock_timestamp()-interval '1 second',query_lease_expires_at=null where attempt_id='${c.dispatched.attempt_id}';`,
  );
}
async function testConcurrency(db) {
  const f = await setup(db);
  const double = await fixture(db, f);
  const same = await race(
    db,
    'same-due',
    service(`select ${double.claim}->>'dispatch';`),
    service(`select ${double.claim}->>'dispatch';`),
  );
  assert.equal(same.winner, 'true');
  assert.equal(same.following.value, 'false');
  double.dispatched = JSON.parse(
    await db.query(
      `select jsonb_build_object('attempt_id',a.id,'lease_token',a.lease_token) from private.payment_attempts a join private.billing_obligations o on o.id=a.obligation_id where o.subscription_id='${double.sid}';`,
    ),
  );
  assert.equal(
    await db.query(
      `select count(*) from private.billing_obligations where subscription_id='${double.sid}';`,
    ),
    '1',
  );
  pass(
    'overlapping renewal workers create one obligation, stable order and dispatch lease',
  );

  const before = await fixture(db, f);
  const cancelFirst = await race(
    db,
    'cancel-first',
    service(`select (${before.cancel}).status;`),
    service(`select ${before.claim}->>'dispatch';`),
  );
  assert.equal(cancelFirst.winner, 'canceled');
  assert.equal(cancelFirst.following.value, 'false');
  pass('cancellation committed first prevents a waiting renewal dispatch');
  const late = await fixture(db, f);
  const chargeFirst = await race(
    db,
    'claim-first',
    service(`select ${late.claim}->>'dispatch';`),
    service(`select (${late.cancel}).status;`),
  );
  assert.equal(chargeFirst.winner, 'true');
  assert.equal(chargeFirst.following.value, 'canceled');
  pass(
    'claim-first cancellation retains unresolved payment for verified recovery',
  );
  late.dispatched = JSON.parse(
    await db.query(
      `select jsonb_build_object('attempt_id',a.id,'lease_token',a.lease_token) from private.payment_attempts a join private.billing_obligations o on o.id=a.obligation_id where o.subscription_id='${late.sid}';`,
    ),
  );
  const approved = await db.query('select clock_timestamp();');
  const final = `public.renewal_finalize('${late.dispatched.attempt_id}','action-${late.sid}','payment-${late.sid}',7200,'KRW','${approved}','${uuid()}')`;
  const settled = await race(
    db,
    'same-finalize',
    service(`select ${final};`),
    service(`select ${final};`),
  );
  assert.equal(settled.following.value, settled.winner);
  assert.equal(
    await db.query(
      `select count(*) from public.payment_events where subscription_id='${late.sid}';`,
    ),
    '2',
  );
  assert.equal(
    await db.query(
      `select status||':'||(next_billing_at is null)::text from public.subscriptions where id='${late.sid}';`,
    ),
    'canceled:true',
  );
  pass(
    'duplicate verified completion commits exactly one renewal while canceled billing stays disabled',
  );

  const retry = await fixture(db, f);
  await fail(db, retry);
  await due(db, retry);
  const retries = await race(
    db,
    'same-retry',
    service(`select ${retry.claim}->>'dispatch';`),
    service(`select ${retry.claim}->>'dispatch';`),
  );
  assert.equal(retries.winner, 'true');
  assert.equal(retries.following.value, 'false');
  assert.equal(
    await db.query(
      `select count(*) from private.payment_attempts a join private.billing_obligations o on o.id=a.obligation_id where o.subscription_id='${retry.sid}';`,
    ),
    '2',
  );
  pass(
    'overlapping due retries retain one period and issue only one additional definitive-failure attempt',
  );
  const terminal = await fixture(db, f);
  await claim(db, terminal);
  const terminalRace = await race(
    db,
    'terminal-vs-claim',
    service(`select ${outcome(terminal, 'failed', false)};`),
    service(`select ${terminal.claim}->>'dispatch';`),
  );
  assert.equal(terminalRace.following.value, 'false');
  assert.equal(
    await db.query(
      `select next_billing_at is null from public.subscriptions where id='${terminal.sid}';`,
    ),
    't',
  );
  pass('terminal decline racing cron clears new charges without erasing grace');

  const unknown = await fixture(db, f);
  await claim(db, unknown);
  const unknownRace = await race(
    db,
    'unknown-vs-claim',
    service(`select ${outcome(unknown)};`),
    service(`select ${unknown.claim}->>'dispatch';`),
  );
  assert.equal(unknownRace.following.value, 'false');
  pass(
    'unknown provider outcome cannot race into a replacement payment attempt',
  );
  await queryDue(db, unknown);
  const queries = await race(
    db,
    'same-query',
    service(`select ${unknown.claim}->>'dispatch';`),
    service(`select ${unknown.claim}->>'dispatch';`),
  );
  assert.equal(queries.winner, 'true');
  assert.equal(queries.following.value, 'false');
  assert.equal(
    await db.query(
      `select query_attempts from private.renewal_attempts where attempt_id='${unknown.dispatched.attempt_id}';`,
    ),
    '1',
  );
  pass('concurrent recovery obtains one bounded read-only query lease');
  const queryToken = await db.query(
    `select query_lease_token from private.renewal_attempts where attempt_id='${unknown.dispatched.attempt_id}';`,
  );
  const completion = `public.renewal_record_query('${unknown.dispatched.attempt_id}','${queryToken}')`;
  const completed = await race(
    db,
    'same-query-complete',
    service(
      `select ${completion}; reset role; select next_query_at from private.renewal_attempts where attempt_id='${unknown.dispatched.attempt_id}';`,
    ),
    service(
      `select ${completion}; reset role; select next_query_at from private.renewal_attempts where attempt_id='${unknown.dispatched.attempt_id}';`,
    ),
  );
  assert.equal(completed.following.value, completed.winner);
  pass(
    'duplicate query completion is a no-op and cannot postpone recovery repeatedly',
  );

  for (const provider of ['toss', 'kakaopay']) {
    const lost = await fixture(db, f, provider);
    await claim(db, lost);
    const lease = await race(
      db,
      `lease-${provider}`,
      // renewal_claim serializes on the subscription before reading the lease.
      // An attempt-only writer is invisible to that MVCC projection until
      // commit, so an unexpired lease correctly returns no-dispatch without
      // waiting on the attempt. Hold the real serialization row first to prove
      // that the claimant rechecks the committed expiry after an observed wait.
      `select 1 from public.subscriptions where id='${lost.sid}' for update;
       update private.payment_attempts set lease_expires_at=clock_timestamp()-interval '1 second' where id='${lost.dispatched.attempt_id}';`,
      service(`select ${lost.claim}->>'dispatch';`),
    );
    assert.equal(lease.following.value, 'false');
    assert.equal(
      await db.query(
        `select state from private.payment_attempts where id='${lost.dispatched.attempt_id}';`,
      ),
      'unknown',
    );
    assert.equal(
      (await call(db, lost.read)).action,
      provider === 'toss' ? 'reconcile' : 'manual_review',
    );
    pass(
      `${provider} expired in-flight lease becomes unknown after lock wait and never recharges`,
    );
  }
  const expiring = await fixture(db, f);
  await fail(db, expiring);
  await due(db, expiring);
  const expiry = await race(
    db,
    'grace-expiry',
    `update public.subscriptions set grace_started_at=clock_timestamp()-interval '2 seconds',grace_ends_at=clock_timestamp()-interval '1 second' where id='${expiring.sid}';`,
    service(`select ${expiring.claim}->>'dispatch';`),
  );
  assert.equal(expiry.following.value, 'false');
  assert.equal(
    await db.query(
      `select status from public.subscriptions where id='${expiring.sid}';`,
    ),
    'expired',
  );
  pass(
    'grace boundary committed while claimant waits expires locally with no clock sleeps',
  );
  const rotated = await fixture(db, f);
  const rotation = await race(
    db,
    'policy-rotation',
    `update private.checkout_policy_current set policy_version='${f.replacementId}';`,
    service(`select ${rotated.claim}->>'dispatch';`),
  );
  assert.equal(rotation.following.value, 'false');
  await db.query(
    `update private.checkout_policy_current set policy_version='${f.policyId}';`,
  );
  pass(
    'policy rotation committed during lock wait blocks stale commercial consent',
  );
  const restricted = await fixture(db, f);
  const restriction = await race(
    db,
    'profile-restriction',
    `update public.profiles set is_restricted=true where id='${f.fanId}';`,
    service(`select ${restricted.claim}->>'dispatch';`),
  );
  assert.equal(restriction.following.value, 'false');
  await db.query(
    `update public.profiles set is_restricted=false where id='${f.fanId}';`,
  );
  pass(
    'current profile restriction blocks a claimant waiting on identity lock',
  );
  const paused = await fixture(db, f);
  const pause = await race(
    db,
    'artist-paused',
    `update public.artists set status='paused' where id='${paused.artistId}';`,
    service(`select ${paused.claim}->>'dispatch';`),
  );
  assert.equal(pause.following.value, 'false');
  pass(
    'artist pause committed during lock wait cannot collect a fresh renewal',
  );

  const notice = await fixture(db, f, 'toss', f.replacementId);
  await db.query(
    `update private.checkout_policy_current set policy_version='${f.replacementId}';`,
  );
  assert.equal((await call(db, notice.read)).action, 'blocked');
  const receipt = `public.renewal_record_notice('${notice.sid}','${notice.data.period_start}','${f.replacementId}',7200,'${notice.data.period_start}'::timestamptz-interval '1 day','${uuid()}')`;
  const noticeRace = await race(
    db,
    'notice-before-claim',
    service(`select ${receipt};`),
    service(`select ${notice.claim}->>'dispatch';`),
  );
  assert.equal(noticeRace.following.value, 'true');
  pass(
    'exact verified advance notice committed first permits the waiting approved period only',
  );
  await db.query(
    `update private.checkout_policy_current set policy_version='${f.policyId}';`,
  );

  // Neutralize earlier fictional candidates only; retain all immutable money.
  await db.query(
    `update public.subscriptions set next_billing_at=null; update private.payment_attempts set state='unknown' where state='inflight'; update private.renewal_attempts set next_query_at=clock_timestamp()+interval '1 year';`,
  );
  const fair = [];
  for (let i = 0; i < 6; i++) fair.push(await fixture(db, f));
  const scans = await race(
    db,
    'fair-scan',
    service('select public.renewal_candidates(3);'),
    service('select public.renewal_candidates(3);'),
  );
  const first = JSON.parse(scans.winner);
  const second = JSON.parse(scans.following.value);
  assert.equal(first.length, 3);
  assert.equal(second.length, 3);
  assert.equal(new Set([...first, ...second]).size, 6);
  assert.deepEqual(
    new Set([...first, ...second]),
    new Set(fair.map((c) => c.sid)),
  );
  pass(
    'concurrent bounded candidate scans serialize fair cursor without starving unavailable prefixes',
  );
  assert.equal(
    await db.query(
      `select count(*) from private.payment_attempts a join private.billing_obligations o on o.id=a.obligation_id where o.subscription_id in (${fair.map((c) => `'${c.sid}'`).join(',')});`,
    ),
    '0',
  );
  pass(
    'candidate cursor movement never creates obligations or grants provider dispatch',
  );
}
try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(
      `select (select count(*) from auth.users)+(select count(*) from public.subscriptions)+(select count(*) from private.checkout_policies)+(select count(*) from private.renewal_policies)+(select count(*) from private.renewal_attempts)+(select count(*) from private.renewal_notice_receipts);`,
    ),
    '0',
    'Use a freshly reset disposable local database only.',
  );
  shouldReset = true;
  await testConcurrency(db);
  assert.equal(checks, 18);
  console.info(
    `All ${checks} PostgreSQL multi-session renewal concurrency checks passed.`,
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.all([...clients].map((client) => client.close()));
  if (shouldReset) {
    try {
      console.info(
        'Restoring disposable local database after fictional fixtures.',
      );
      execFileSync(localCli, ['db', 'reset', '--local'], { stdio: 'inherit' });
    } catch (error) {
      console.error(
        'Local fixture cleanup failed. Run npm run db:reset before reuse.',
        error,
      );
      process.exitCode = 1;
    }
  }
}
