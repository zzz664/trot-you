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
    this.label = `checkout-concurrency-${label}`;
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
    const marker = `CHECKOUT_TEST_DONE_${++commandSequence}`;
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
const authenticated = (userId, sql) =>
  `set local role authenticated; set local "request.jwt.claim.sub" = '${userId}'; ${sql}`;
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

async function fixture(db) {
  const fanId = uuid();
  const artistId = uuid();
  const termsId = uuid();
  const privacyId = uuid();
  const policyId = uuid();
  const replacementId = uuid();
  const slug = `checkout-race-${artistId}`;
  await db.query(`
    insert into auth.users(id,email,raw_user_meta_data)
      values('${fanId}','checkout-race@example.invalid','{}');
    insert into public.artists(id,slug,name,grade,status)
      values('${artistId}','${slug}','허구 결제 준비 경합 가수','B','active');
    insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
      ('${termsId}','terms','Fictional terms','Only a disposable race fixture.',now(),now()),
      ('${privacyId}','privacy','Fictional privacy','Only a disposable race fixture.',now(),now());
    insert into private.profile_onboarding_policy values(true,'${uuid()}',now(),2,10,
      array['금지단어'],'${termsId}','${privacyId}',null);
    insert into private.checkout_policies values
      ('${policyId}','허구 구독 정책','실제 운영과 무관한 경합 테스트 전용 문서입니다.',7200,1200,now(),now()),
      ('${replacementId}','허구 변경 정책','실제 운영과 무관한 정책 회전 테스트 문서입니다.',7300,1300,now(),now());
    insert into private.checkout_policy_current values(true,'${policyId}');
    begin;
      ${authenticated(
        fanId,
        `select public.onboarding_save_font('large');
        select public.onboarding_save_name('허구구독팬');
        select public.onboarding_complete_profile(true,true,'${termsId}',true,'${privacyId}');
        select public.discovery_select_artist('${slug}');
        select public.onboarding_acknowledge_install('skipped');
        select public.onboarding_complete();`,
      )}
    commit;
  `);
  return { fanId, artistId, termsId, privacyId, policyId, replacementId, slug };
}

async function testConcurrency(db) {
  const f = await fixture(db);
  const service = (sql) => `set local role service_role; ${sql}`;
  const firstKey = uuid();
  const prepare = (key = firstKey, nonce = 'a', provider = 'toss') =>
    service(`
    select session_id::text || '|' || nonce_matches::text
    from public.checkout_prepare_session('${f.fanId}','${f.slug}','${provider}','test',
      '${key}',repeat('${nonce}',64),'${f.policyId}',true);`);
  const cancel = (sessionId, nonce) =>
    service(`
    select public.checkout_cancel_session('${f.fanId}','${sessionId}',repeat('${nonce}',64));`);
  const noMoney = async () =>
    assert.equal(
      await db.query(`select (select count(*) from public.payment_events) +
      (select count(*) from private.payment_mandates) +
      (select count(*) from private.billing_obligations) +
      (select count(*) from private.payment_attempts);`),
      '0',
    );

  const duplicate = await race(db, 'same-key-create', prepare(), prepare());
  assert.equal(duplicate.following.error, undefined);
  assert.equal(duplicate.winner, duplicate.following.value);
  assert.match(duplicate.winner, /^[a-f0-9-]{36}\|true$/);
  const firstId = duplicate.winner.split('|')[0];
  assert.equal(
    await db.query('select count(*) from private.checkout_sessions;'),
    '1',
  );
  console.info(
    'PASS: simultaneous same-key preparation returns one original session',
  );

  const different = await race(
    db,
    'different-key-create',
    prepare(),
    prepare(uuid(), 'b', 'kakaopay'),
  );
  assert.match(
    different.following.error?.message ?? '',
    /CHECKOUT_SESSION_EXISTS/,
  );
  assert.equal(
    await db.query('select count(*) from private.checkout_sessions;'),
    '1',
  );
  console.info(
    'PASS: distinct key and provider cannot fork pending intent while waiting',
  );

  const lost = await race(
    db,
    'lost-response-nonce',
    prepare(),
    prepare(firstKey, 'b'),
  );
  assert.equal(lost.following.error, undefined);
  assert.equal(lost.following.value, `${firstId}|false`);
  assert.equal(
    await db.query(
      `select nonce_hash=repeat('a',64) from private.checkout_sessions where id='${firstId}';`,
    ),
    't',
  );
  console.info(
    'PASS: concurrent replay with fresh nonce preserves original digest and reports mismatch',
  );

  const secondKey = uuid();
  const canceled = await race(
    db,
    'cancel-before-new-intent',
    cancel(firstId, 'a'),
    prepare(secondKey, 'c', 'kakaopay'),
  );
  assert.equal(canceled.following.error, undefined);
  const secondId = canceled.following.value?.split('|')[0];
  assert.ok(secondId && secondId !== firstId);
  assert.equal(
    await db.query(
      `select count(*) from private.checkout_sessions where status='pending_intent';`,
    ),
    '1',
  );
  console.info(
    'PASS: new preparation waits for cancellation and creates exactly one new provider intent',
  );

  const cancellation = await race(
    db,
    'prepare-before-cancel',
    prepare(secondKey, 'c', 'kakaopay'),
    cancel(secondId, 'c'),
  );
  assert.equal(cancellation.following.error, undefined);
  assert.equal(
    await db.query(
      `select status from private.checkout_sessions where id='${secondId}';`,
    ),
    'canceled',
  );
  console.info(
    'PASS: cancellation serializes behind original preparation without creating payment work',
  );

  const rotated = await race(
    db,
    'commercial-policy-before-prepare',
    `update private.checkout_policy_current set policy_version='${f.replacementId}';`,
    prepare(uuid()),
  );
  assert.match(
    rotated.following.error?.message ?? '',
    /CHECKOUT_POLICY_CHANGED/,
  );
  await db.query(
    `update private.checkout_policy_current set policy_version='${f.policyId}';`,
  );
  console.info(
    'PASS: preparation waiting behind commercial policy rotation rejects old acceptance',
  );

  const paused = await race(
    db,
    'artist-before-prepare',
    `update public.artists set status='paused' where id='${f.artistId}';`,
    prepare(uuid()),
  );
  assert.match(paused.following.error?.message ?? '', /CHECKOUT_NOT_FOUND/);
  await db.query(
    `update public.artists set status='active' where id='${f.artistId}';`,
  );
  console.info(
    'PASS: preparation waiting behind artist deactivation fails closed',
  );

  const restricted = await race(
    db,
    'restriction-before-prepare',
    `update public.profiles set is_restricted=true where id='${f.fanId}';`,
    prepare(uuid()),
  );
  assert.match(
    restricted.following.error?.message ?? '',
    /DISCOVERY_FORBIDDEN/,
  );
  await db.query(
    `update public.profiles set is_restricted=false where id='${f.fanId}';`,
  );
  console.info(
    'PASS: preparation waiting behind actor restriction fails closed',
  );

  const withdrawn = await race(
    db,
    'consent-withdrawal-before-prepare',
    `delete from private.profile_policy_acceptances where user_id='${f.fanId}' and kind='terms';`,
    prepare(uuid()),
  );
  assert.match(
    withdrawn.following.error?.message ?? '',
    /(DISCOVERY|CHECKOUT)_PROFILE_REQUIRED/,
  );
  await db.query(
    `insert into private.profile_policy_acceptances values('${f.fanId}','terms','${f.termsId}',now());`,
  );
  console.info(
    'PASS: preparation locks current consent evidence and rejects a winning withdrawal',
  );

  const expiryKey = uuid();
  const expiryResult = await db.query(
    `begin; ${prepare(expiryKey, 'd')} commit;`,
  );
  const expiryId = expiryResult.split('|')[0];
  const expired = await race(
    db,
    'expiry-while-cancel-waits',
    `select id from public.profiles where id='${f.fanId}' for update;
     update private.checkout_sessions set created_at=clock_timestamp()-interval '14 minutes',
       expires_at=clock_timestamp()+interval '150 milliseconds' where id='${expiryId}';`,
    cancel(expiryId, 'd'),
    async () => {
      // Wait past the actual database expiry condition, not a guessed race.
      await db.query('select pg_sleep(0.2);');
    },
  );
  assert.match(
    expired.following.error?.message ?? '',
    /CHECKOUT_SESSION_EXPIRED/,
  );
  console.info(
    'PASS: a cancellation waiting past TTL cannot consume an expired nonce',
  );

  const subscriptionId = uuid();
  const existing = await race(
    db,
    'subscription-before-prepare',
    `insert into public.subscriptions(id,user_id,artist_id,provider,status)
      values('${subscriptionId}','${f.fanId}','${f.artistId}','toss','pending');`,
    prepare(uuid()),
  );
  assert.match(
    existing.following.error?.message ?? '',
    /CHECKOUT_SUBSCRIPTION_EXISTS/,
  );
  console.info(
    'PASS: concurrent existing subscription creation blocks competing checkout intent',
  );

  await noMoney();
  assert.equal(
    await db.query('select count(*) from public.subscriptions;'),
    '1',
  );
}

try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(`select
      (select count(*) from auth.users) +
      (select count(*) from public.profiles) +
      (select count(*) from public.subscriptions) +
      (select count(*) from public.payment_events) +
      (select count(*) from public.messages) +
      (select count(*) from private.artist_interests) +
      (select count(*) from private.onboarding_install_guidance) +
      (select count(*) from private.checkout_policies) +
      (select count(*) from private.checkout_policy_current) +
      (select count(*) from private.checkout_sessions) +
      (select count(*) from private.profile_onboarding_policy) +
      (select count(*) from private.onboarding_documents) +
      (select count(*) from private.profile_policy_acceptances) +
      (select count(*) from public.artists where id not in (
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002'));`),
    '0',
    'Use a freshly reset disposable local database with fictional seeds only; this test resets it afterward.',
  );
  shouldReset = true;
  await testConcurrency(db);
  console.info(
    'All eleven PostgreSQL multi-session checkout concurrency checks passed.',
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
