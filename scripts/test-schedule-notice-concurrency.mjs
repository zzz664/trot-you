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
    this.label = `schedule-notice-concurrency-${label}`;
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
    const marker = `SCHEDULE_NOTICE_TEST_DONE_${++commandSequence}`;
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
const policy = 'bb600000-0000-4000-8000-000000000001';
const create = (f) =>
  service(
    `select push_jobs from public.schedule_notice_create('${f.eventId}');`,
  );
const claim = (f) =>
  service(`select count(*) from public.notification_claim('${f.jobId}');`);
const prepare = (f) =>
  service(
    `select count(*) from public.webpush_prepare_delivery('${f.jobId}','${f.token}');`,
  );
const globalPreference = (f, enabled) =>
  authenticated(
    f.fanId,
    `select schedule_enabled from public.schedule_notice_set_preference(${enabled});`,
  );
const eventPreference = (f, enabled) =>
  authenticated(
    f.fanId,
    `select event_enabled from public.schedule_notice_set_event('${f.eventId}',${enabled});`,
  );
function value(result) {
  assert.equal(result.following.error, undefined);
  return result.following.value;
}
async function fixture(db, queue = true, lease = true) {
  const f = {
    fanId: uuid(),
    adminId: uuid(),
    artistId: uuid(),
    sessionId: uuid(),
    subscriptionId: uuid(),
    eventId: uuid(),
    deviceId: uuid(),
  };
  await db.query(`insert into private.schedule_notice_policy_current(policy_version) values('${policy}')
    on conflict(singleton) do update set policy_version=excluded.policy_version;
    insert into auth.users(id,email,raw_user_meta_data) values('${f.fanId}','${f.fanId}@example.invalid','{}'),('${f.adminId}','${f.adminId}@example.invalid','{}');
    update public.profiles set call_name='가상 일정 팬',onboarding_completed_at=clock_timestamp() where id in('${f.fanId}','${f.adminId}');
    update public.profiles set role='admin' where id='${f.adminId}';
    insert into auth.sessions(id,user_id,created_at,updated_at) values('${f.sessionId}','${f.fanId}',clock_timestamp(),clock_timestamp());
    insert into public.artists(id,slug,name,grade,status) values('${f.artistId}','notice-race-${f.artistId}','Fictional notice race artist','B','active');
    insert into public.subscriptions(id,user_id,artist_id,provider,status,current_period_start,current_period_end,created_at)
      values('${f.subscriptionId}','${f.fanId}','${f.artistId}','toss','active',clock_timestamp()-interval '1 day',clock_timestamp()+interval '5 days',clock_timestamp()-interval '2 days');
    insert into private.notification_preferences(user_id,webpush_enabled,new_message,billing,schedule) values('${f.fanId}',true,true,true,true);
    insert into private.push_subscriptions(id,user_id,endpoint,p256dh,auth,consent_version,auth_session_id)
      values('${f.deviceId}','${f.fanId}','https://push.example.invalid/${f.deviceId}',repeat('B',87),repeat('A',22),'fictional-notice-consent','${f.sessionId}');
    insert into public.schedules(id,artist_id,type,status,title,starts_at,created_by)
      values('${f.eventId}','${f.artistId}','event','published','Fictional notice race event',
       (((clock_timestamp() at time zone 'Asia/Seoul')::date+1)::timestamp+interval '12 hours') at time zone 'Asia/Seoul','${f.adminId}');`);
  if (queue) {
    assert.equal(await db.query(`begin; ${create(f)} commit;`), '1');
    f.jobId = await db.query(
      `select id from private.notification_jobs where source_id='${f.eventId}';`,
    );
    if (lease) {
      const result = JSON.parse(
        await db.query(
          `begin; ${service(`select row_to_json(c) from public.notification_claim('${f.jobId}') c;`)} commit;`,
        ),
      );
      f.token = result.lease_token;
      assert.match(f.token, /^[a-f0-9-]{36}$/);
    }
  }
  return f;
}
async function run(db) {
  await db.query(`insert into private.notification_policy(version,consent_version,webpush_enabled,max_attempts,retry_seconds,lease_seconds,schedule_lead_seconds)
    values('fictional-notice','fictional-notice-consent',true,3,10,30,86400);
    insert into private.schedule_notice_policies values('${policy}',0,clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day');`);
  {
    const f = await fixture(db, false);
    const result = await race(db, 'duplicate-queue', create(f), create(f));
    assert.equal(result.winner, '1');
    assert.equal(value(result), '0');
    assert.equal(
      await db.query(
        `select count(*) from private.notification_jobs where source_id='${f.eventId}';`,
      ),
      '1',
    );
    console.info(
      'PASS: overlapping queue workers create one durable source/device job',
    );
  }
  {
    const f = await fixture(db, false);
    const result = await race(
      db,
      'edit-before-create',
      `update public.schedules set starts_at=starts_at+interval '1 day' where id='${f.eventId}';`,
      create(f),
    );
    assert.equal(value(result), '0');
    assert.equal(
      await db.query(
        `select count(*) from private.notification_jobs where source_id='${f.eventId}';`,
      ),
      '0',
    );
    console.info(
      'PASS: next-day selection rechecks event timestamp after source lock wait',
    );
  }
  {
    const f = await fixture(db, false);
    const result = await race(
      db,
      'optout-before-create',
      eventPreference(f, false),
      create(f),
    );
    assert.equal(value(result), '0');
    console.info(
      'PASS: committed event optout before queue source lock excludes recipient',
    );
  }
  {
    const f = await fixture(db, false);
    const result = await race(
      db,
      'create-before-optout',
      create(f),
      eventPreference(f, false),
    );
    assert.equal(value(result), 'f');
    assert.equal(
      await db.query(
        `select state from private.notification_jobs where source_id='${f.eventId}';`,
      ),
      'canceled',
    );
    console.info(
      'PASS: event optout waiting behind queue creation cancels newly committed unsent job',
    );
  }
  {
    const f = await fixture(db, false);
    const result = await race(
      db,
      'global-settings-idempotent',
      globalPreference(f, false),
      globalPreference(f, false),
    );
    assert.equal(result.winner, 'f');
    assert.equal(value(result), 'f');
    assert.equal(
      await db.query(
        `select new_message and billing and webpush_enabled and not schedule from private.notification_preferences where user_id='${f.fanId}';`,
      ),
      't',
    );
    console.info(
      'PASS: concurrent explicit global saves are idempotent and preserve other preference fields',
    );
  }
  const fences = [
    ['event-optout', (f) => eventPreference(f, false)],
    ['global-optout', (f) => globalPreference(f, false)],
    [
      'restriction',
      (f) =>
        `update public.profiles set is_restricted=true where id='${f.fanId}';`,
    ],
    [
      'role-loss',
      (f) => `update public.profiles set role='artist' where id='${f.fanId}';`,
    ],
    [
      'artist-pause',
      (f) =>
        `update public.artists set status='paused' where id='${f.artistId}';`,
    ],
    [
      'subscription-expiry',
      (f) =>
        `update public.subscriptions set current_period_end=clock_timestamp()-interval '1 second' where id='${f.subscriptionId}';`,
    ],
    [
      'event-edit',
      (f) =>
        `update public.schedules set starts_at=starts_at+interval '1 hour' where id='${f.eventId}';`,
    ],
    [
      'event-unpublish',
      (f) =>
        `update public.schedules set status='draft' where id='${f.eventId}';`,
    ],
    [
      'event-delete',
      (f) =>
        authenticated(
          f.adminId,
          `select public.schedule_delete('${f.eventId}');`,
        ),
    ],
    [
      'session-revocation',
      (f) => `delete from auth.sessions where id='${f.sessionId}';`,
    ],
    [
      'device-revocation',
      (f) =>
        service(
          `select public.webpush_revoke_device('${f.fanId}','${f.sessionId}','https://push.example.invalid/${f.deviceId}');`,
        ),
    ],
    [
      'policy-deactivation',
      () => `delete from private.schedule_notice_policy_current;`,
    ],
  ];
  for (const [name, mutation] of fences) {
    const f = await fixture(db);
    const result = await race(
      db,
      `${name}-before-prepare`,
      mutation(f),
      prepare(f),
    );
    assert.equal(value(result), '0');
    assert.equal(
      await db.query(
        `select state from private.notification_jobs where id='${f.jobId}';`,
      ),
      'canceled',
    );
    assert.equal(
      await db.query(
        `select count(*) from private.notification_attempts where job_id='${f.jobId}';`,
      ),
      '1',
    );
    console.info(
      `PASS: ${name} committed during final-preparation lock wait blocks external delivery and retains attempt history`,
    );
  }
  {
    const f = await fixture(db, true, false);
    const result = await race(
      db,
      'optout-before-claim',
      eventPreference(f, false),
      claim(f),
    );
    assert.equal(value(result), '0');
    assert.equal(
      await db.query(
        `select attempt_count from private.notification_jobs where id='${f.jobId}';`,
      ),
      '0',
    );
    console.info('PASS: optout before claim consumes no provider attempt');
  }
  for (const mutation of ['delete', 'expire']) {
    const f = await fixture(db, true, false);
    const sql =
      mutation === 'delete'
        ? `delete from auth.sessions where id='${f.sessionId}';`
        : `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${f.sessionId}';`;
    const result = await race(
      db,
      `${mutation}-session-before-claim`,
      sql,
      claim(f),
    );
    assert.equal(value(result), '0');
    assert.equal(
      await db.query(
        `select attempt_count from private.notification_jobs where id='${f.jobId}';`,
      ),
      '0',
    );
    console.info(
      `PASS: ${mutation} session before claim cannot expose endpoint or consume an attempt`,
    );
  }
  {
    const f = await fixture(db);
    const result = await race(db, 'duplicate-prepare', prepare(f), prepare(f));
    assert.equal(result.winner, '1');
    assert.equal(value(result), '0');
    console.info(
      'PASS: concurrent same-token final preparation exposes one network capability',
    );
  }
  {
    const f = await fixture(db);
    await db.query(`begin; ${prepare(f)} commit;
      begin; ${service(`select public.webpush_complete('${f.jobId}','${f.token}','unknown',null);`)} commit;
      update private.notification_jobs set lease_expires_at=clock_timestamp()-interval '30 seconds',next_attempt_at=clock_timestamp()-interval '1 second' where id='${f.jobId}';`);
    const result = await race(
      db,
      'optout-before-unknown-recovery',
      eventPreference(f, false),
      service(
        `select public.webpush_recover_expired('${f.jobId}','${f.token}');`,
      ),
    );
    assert.equal(value(result), 'canceled');
    assert.equal(
      await db.query(
        `select state from private.notification_attempts where token='${f.token}';`,
      ),
      'unknown',
    );
    console.info(
      'PASS: optout blocks ambiguous schedule retry without falsely recording a definite non-send',
    );
  }
  {
    const f = await fixture(db);
    await db.query(`begin; ${prepare(f)} commit;`);
    const evidence = uuid();
    const result = await race(
      db,
      'optout-before-acceptance',
      eventPreference(f, false),
      service(
        `select public.webpush_complete('${f.jobId}','${f.token}','provider_accepted','${evidence}');`,
      ),
    );
    assert.equal(value(result), 'provider_accepted');
    assert.equal(
      await db.query(
        `select cancellation_requested_at is not null and provider_accepted_at is not null from private.notification_jobs where id='${f.jobId}';`,
      ),
      't',
    );
    console.info(
      'PASS: provider acceptance after opted-out in-flight send remains truthful and is not claimed recalled',
    );
  }
}
try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(
      `select (select count(*) from auth.users)+(select count(*) from private.notification_policy)+(select count(*) from private.schedule_notice_policies);`,
    ),
    '0',
    'Use freshly reset disposable database only.',
  );
  shouldReset = true;
  await run(db);
  console.info(
    'All schedule notice independent-session PostgreSQL races passed.',
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.all([...clients].map((client) => client.close()));
  if (shouldReset) {
    try {
      execFileSync(localCli, ['db', 'reset', '--local'], { stdio: 'inherit' });
    } catch (error) {
      console.error(
        'Fixture cleanup failed; reset disposable database before further use.',
        error,
      );
      process.exitCode = 1;
    }
  }
}
