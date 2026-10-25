import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { activityLockQuery } from './activity-race-observer.mjs';

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
    this.label = `webpush-concurrency-${label}`;
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
    const marker = `WEBPUSH_TEST_DONE_${++commandSequence}`;
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
    this.pid = Number(await this.query('select pg_backend_pid();'));
    assert.ok(Number.isSafeInteger(this.pid) && this.pid > 0);
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
    const result = await observer.query(
      activityLockQuery(waiting.pid, blocking.pid),
    );
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

const service = (sql) => `set local role service_role; ${sql}`;
const withSession = (f, sql) =>
  authenticated(
    f.fanId,
    `set local "request.jwt.claims"='{"sub":"${f.fanId}","session_id":"${f.sessionId}"}'; ${sql}`,
  );
const register = (f, endpoint = f.endpoint) =>
  service(
    `select public.webpush_register_device('${f.fanId}','${f.sessionId}','${endpoint}',repeat('B',87),repeat('A',22),'fictional-webpush-consent');`,
  );
const prepare = (f) =>
  service(
    `select count(*) from public.webpush_prepare_delivery('${f.jobId}','${f.token}');`,
  );
const recover = (f) =>
  service(`select public.webpush_recover_expired('${f.jobId}','${f.token}');`);
const complete = (f, outcome = 'provider_accepted') =>
  service(
    `select public.webpush_complete('${f.jobId}','${f.token}','${outcome}',${outcome === 'unknown' ? 'null' : `'${uuid()}'`});`,
  );
function value(result) {
  assert.equal(result.following.error, undefined);
  return result.following.value;
}
function expectedError(result, code) {
  assert.ok(result.following.error, `expected ${code}`);
  assert.match(String(result.following.error), new RegExp(code));
  assert.doesNotMatch(
    String(result.following.error),
    /deadlock detected|lock timeout|statement timeout/,
  );
}
async function fixture(db) {
  const f = {
    fanId: uuid(),
    authorId: uuid(),
    artistId: uuid(),
    sessionId: uuid(),
    subscriptionId: uuid(),
    messageId: uuid(),
    endpoint: `https://push.example.invalid/${uuid()}`,
  };
  await db.query(`
    insert into auth.users(id,email,raw_user_meta_data) values
      ('${f.fanId}','${f.fanId}@example.invalid','{}'),('${f.authorId}','${f.authorId}@example.invalid','{}');
    update public.profiles set call_name='가상 알림 팬',onboarding_completed_at=now() where id in('${f.fanId}','${f.authorId}');
    update public.profiles set role='artist' where id='${f.authorId}';
    insert into auth.sessions(id,user_id,created_at,updated_at) values('${f.sessionId}','${f.fanId}',now(),now());
    insert into public.artists(id,slug,name,grade,status) values('${f.artistId}','webpush-race-${f.artistId}','가상 알림 가수','B','active');
    insert into public.artist_members(artist_id,user_id) values('${f.artistId}','${f.authorId}');
    insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end)
      values('${f.subscriptionId}','${f.fanId}','${f.artistId}','toss','active',now()-interval '1 day',now()-interval '1 day',now()-interval '1 day',now()+interval '1 day');
  `);
  f.deviceId = await db.query(`begin; ${register(f)} commit;`);
  await db.query(`insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
    values('${f.messageId}','${f.artistId}','${f.authorId}','text','가상 비공개 메시지','sent',now(),now());`);
  f.jobId = await db.query(
    `select id from private.notification_jobs where source_id='${f.messageId}' and device_id='${f.deviceId}';`,
  );
  const claimed = JSON.parse(
    await db.query(
      `begin; ${service(`select row_to_json(c) from public.notification_claim('${f.jobId}') c;`)} commit;`,
    ),
  );
  f.token = claimed.lease_token;
  assert.match(f.token, /^[a-f0-9-]{36}$/);
  return f;
}
async function expiredUnknown(db, f) {
  await db.query(`begin; ${prepare(f)} commit; begin; ${complete(f, 'unknown')} commit;
    update private.notification_jobs set lease_expires_at=clock_timestamp()-interval '30 seconds',next_attempt_at=clock_timestamp()-interval '1 second' where id='${f.jobId}';`);
}
async function testConcurrency(db) {
  await db.query(`
    insert into private.message_policy(version,history_before_seconds,cancel_window_seconds,max_text_length,max_reply_length,
      max_photos,max_voice_seconds,max_video_seconds,preview_max_count,max_photo_bytes,max_voice_bytes,max_video_bytes)
      values('fictional-webpush-message',604800,300,1000,100,10,180,60,5,10485760,20971520,104857600);
    insert into private.notification_policy(version,consent_version,webpush_enabled,max_attempts,retry_seconds,lease_seconds,schedule_lead_seconds)
      values('fictional-webpush','fictional-webpush-consent',true,3,10,30,86400);
  `);
  const changes = [
    [
      'restriction-before-prepare',
      (f) =>
        `update public.profiles set is_restricted=true where id='${f.fanId}';`,
    ],
    [
      'role-loss-before-prepare',
      (f) => `update public.profiles set role='artist' where id='${f.fanId}';`,
    ],
    [
      'subscription-expiry-before-prepare',
      (f) =>
        `update public.subscriptions set current_period_end=clock_timestamp()-interval '1 second' where id='${f.subscriptionId}';`,
    ],
    [
      'artist-paused-before-prepare',
      (f) =>
        `update public.artists set status='paused' where id='${f.artistId}';`,
    ],
    [
      'source-cancel-before-prepare',
      (f) =>
        `update public.messages set status='canceled',canceled_at=clock_timestamp() where id='${f.messageId}';`,
    ],
    [
      'preferences-before-prepare',
      (f) =>
        authenticated(
          f.fanId,
          'select public.notification_set_preferences(false,false,false,false);',
        ),
    ],
    [
      'device-revoke-before-prepare',
      (f) =>
        service(
          `select public.webpush_revoke_device('${f.fanId}','${f.sessionId}','${f.endpoint}');`,
        ),
    ],
    [
      'logout-before-prepare',
      (f) => withSession(f, 'select public.webpush_revoke_session();'),
    ],
    [
      'session-delete-before-prepare',
      (f) => `delete from auth.sessions where id='${f.sessionId}';`,
    ],
    [
      'session-expiry-before-prepare',
      (f) =>
        `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${f.sessionId}';`,
    ],
    [
      'native-optout-before-prepare',
      (f) =>
        withSession(
          f,
          `select public.webpush_revoke_current_device('${f.endpoint}');`,
        ),
    ],
  ];
  for (const [label, change] of changes) {
    const f = await fixture(db);
    const result = await race(db, label, change(f), prepare(f));
    assert.equal(value(result), '0', label);
    assert.equal(
      await db.query(
        `select state from private.notification_jobs where id='${f.jobId}';`,
      ),
      'canceled',
    );
    console.info(
      `PASS: ${label} serializes and suppresses fresh send authorization`,
    );
  }
  {
    const f = await fixture(db);
    const result = await race(
      db,
      'consent-rotation-before-prepare',
      "update private.notification_policy set consent_version='rotated-consent';",
      prepare(f),
    );
    assert.equal(value(result), '0');
    await db.query(
      "update private.notification_policy set consent_version='fictional-webpush-consent';",
    );
    console.info(
      'PASS: current consent version is rechecked after a real policy lock wait',
    );
  }
  {
    const f = await fixture(db);
    const result = await race(db, 'duplicate-prepare', prepare(f), prepare(f));
    assert.equal(result.winner, '1');
    assert.equal(value(result), '0');
    console.info(
      'PASS: competing prepare calls expose endpoint material only once per lease',
    );
  }
  {
    const f = await fixture(db);
    const result = await race(
      db,
      'prepare-before-logout',
      prepare(f),
      withSession(f, 'select public.webpush_revoke_session();'),
    );
    assert.equal(result.winner, '1');
    assert.equal(value(result), '1');
    assert.equal(
      await db.query(`begin; ${complete(f)} commit;`),
      'provider_accepted',
    );
    console.info(
      'PASS: prepare precedes logout; already in-flight acceptance is retained without a recall claim',
    );
  }
  {
    const f = await fixture(db);
    const result = await race(
      db,
      'prepare-before-session-delete',
      prepare(f),
      `delete from auth.sessions where id='${f.sessionId}'; select 'deleted';`,
    );
    assert.equal(result.winner, '1');
    assert.equal(value(result), 'deleted');
    console.info(
      'PASS: Auth session deletion serializes against final eligibility, without promising recall',
    );
  }
  {
    const f = await fixture(db);
    await expiredUnknown(db, f);
    const result = await race(db, 'competing-recovery', recover(f), recover(f));
    assert.equal(result.winner, 'retry_wait');
    assert.equal(value(result), 'retry_wait');
    assert.equal(
      await db.query(
        `select attempt_count from private.notification_jobs where id='${f.jobId}';`,
      ),
      '1',
    );
    const claim = JSON.parse(
      await db.query(
        `begin; ${service(`select row_to_json(c) from public.notification_claim('${f.jobId}') c;`)} commit;`,
      ),
    );
    assert.notEqual(claim.lease_token, f.token);
    assert.equal(
      await db.query(
        `select attempt_count from private.notification_jobs where id='${f.jobId}';`,
      ),
      '2',
    );
    console.info(
      'PASS: competing recovery preserves one next attempt and a fresh fence token',
    );
  }
  {
    const f = await fixture(db);
    await expiredUnknown(db, f);
    const result = await race(
      db,
      'acceptance-before-recovery',
      complete(f),
      recover(f),
    );
    assert.equal(result.winner, 'provider_accepted');
    assert.equal(value(result), 'provider_accepted');
    console.info(
      'PASS: definitive acceptance winning the race suppresses recovery',
    );
  }
  {
    const f = await fixture(db);
    await expiredUnknown(db, f);
    const result = await race(
      db,
      'recovery-before-old-completion',
      recover(f),
      complete(f),
    );
    assert.equal(result.winner, 'retry_wait');
    expectedError(result, 'NOTIFICATION_LEASE_INVALID');
    console.info(
      'PASS: late old-worker completion cannot overwrite a recovered attempt',
    );
  }
  {
    const f = await fixture(db);
    await expiredUnknown(db, f);
    const result = await race(
      db,
      'optout-before-recovery',
      withSession(
        f,
        `select public.webpush_revoke_current_device('${f.endpoint}');`,
      ),
      recover(f),
    );
    assert.equal(value(result), 'canceled');
    assert.equal(
      await db.query(
        `select state from private.notification_attempts where token='${f.token}';`,
      ),
      'unknown',
    );
    console.info(
      'PASS: recovery respects concurrent opt-out and preserves ambiguous-send evidence',
    );
  }
  {
    const f = await fixture(db);
    for (let i = 0; i < 8; i += 1)
      await db.query(
        `begin; ${register(f, `https://push.example.invalid/${uuid()}`)} commit;`,
      );
    const result = await race(
      db,
      'parallel-device-cap',
      register(f, `https://push.example.invalid/${uuid()}`),
      register(f, `https://push.example.invalid/${uuid()}`),
    );
    expectedError(result, 'WEBPUSH_DEVICE_LIMIT');
    assert.equal(
      await db.query(
        `select count(*) from private.push_subscriptions where user_id='${f.fanId}' and state='active';`,
      ),
      '10',
    );
    console.info(
      'PASS: parallel registrations cannot exceed the active-device structural cap',
    );
  }
  {
    const first = await fixture(db),
      second = await fixture(db);
    const endpoint = `https://push.example.invalid/${uuid()}`;
    const result = await race(
      db,
      'endpoint-ownership-conflict',
      register(first, endpoint),
      register(second, endpoint),
    );
    expectedError(result, 'NOTIFICATION_DEVICE_CONFLICT');
    assert.equal(
      await db.query(
        `select user_id from private.push_subscriptions where endpoint='${endpoint}';`,
      ),
      first.fanId,
    );
    console.info(
      'PASS: competing different-user registration never transfers endpoint ownership',
    );
  }
  {
    const f = await fixture(db),
      nextSession = uuid();
    await db.query(
      `insert into auth.sessions(id,user_id,created_at,updated_at) values('${nextSession}','${f.fanId}',now(),now());`,
    );
    const result = await race(
      db,
      'session-rebind-before-prepare',
      register({ ...f, sessionId: nextSession }),
      prepare(f),
    );
    assert.equal(value(result), '0');
    assert.equal(
      await db.query(
        `select auth_session_id from private.push_subscriptions where id='${f.deviceId}';`,
      ),
      nextSession,
    );
    console.info(
      'PASS: explicit new-session opt-in cancels old-session queued and leased work',
    );
  }
  for (const outcome of ['not_sent', 'unknown']) {
    const f = await fixture(db),
      evidence = outcome === 'unknown' ? 'null' : `'${uuid()}'`;
    const completion = (seconds) =>
      service(
        `select public.webpush_complete('${f.jobId}','${f.token}','${outcome}',${evidence},${seconds});`,
      );
    const result = await race(
      db,
      `retry-after-replay-${outcome}`,
      completion(120),
      completion(86400),
    );
    assert.equal(
      value(result),
      outcome === 'unknown' ? 'unknown' : 'retry_wait',
    );
    assert.equal(
      await db.query(
        `select retry_after_seconds from private.notification_attempts where token='${f.token}';`,
      ),
      '120',
    );
    assert.equal(
      await db.query(
        `select extract(epoch from j.next_attempt_at-(case when '${outcome}'='unknown' then j.lease_expires_at else a.finished_at end))::integer from private.notification_jobs j join private.notification_attempts a on a.token=j.lease_token where j.id='${f.jobId}';`,
      ),
      '120',
    );
    console.info(
      `PASS: concurrent ${outcome} replay cannot replace the first provider Retry-After deadline`,
    );
  }
}
try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(`select
    (select count(*) from auth.users)+(select count(*) from public.profiles)+
    (select count(*) from public.subscriptions)+(select count(*) from public.messages)+
    (select count(*) from private.notification_policy)+(select count(*) from private.push_subscriptions)+
    (select count(*) from private.notification_jobs)+
    (select count(*) from public.artists where id not in('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'));`),
    '0',
    'Use a freshly reset disposable local database; this script restores it afterward.',
  );
  shouldReset = true;
  await testConcurrency(db);
  console.info(
    'All Web Push PostgreSQL multi-session concurrency checks passed.',
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.all([...clients].map((client) => client.close()));
  if (shouldReset) {
    try {
      console.info(
        'Restoring disposable local database after committed Web Push fixtures.',
      );
      execFileSync(localCli, ['db', 'reset', '--local'], { stdio: 'inherit' });
    } catch (error) {
      console.error(
        'Fixture cleanup failed. Run npm run db:reset before using this disposable database again.',
        error,
      );
      process.exitCode = 1;
    }
  }
}
