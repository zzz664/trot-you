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
    this.label = `schedule-concurrency-${label}`;
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
    const marker = `SCHEDULE_TEST_DONE_${++commandSequence}`;
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
  const adminId = uuid();
  const secondAdminId = uuid();
  const artistId = uuid();
  await db.query(`
    insert into auth.users(id,email,raw_user_meta_data) values
      ('${fanId}','schedule-fan@example.invalid','{}'),
      ('${adminId}','schedule-admin@example.invalid','{}'),
      ('${secondAdminId}','schedule-second-admin@example.invalid','{}');
    update public.profiles set call_name='Fictional schedule fan',
      onboarding_completed_at=statement_timestamp() where id in
      ('${fanId}','${adminId}','${secondAdminId}');
    update public.profiles set role='admin' where id in ('${adminId}','${secondAdminId}');
    insert into public.artists(id,slug,name,grade,status)
      values ('${artistId}','schedule-concurrency-${artistId}','Fictional schedule artist','B','active');
  `);
  return { fanId, adminId, secondAdminId, artistId };
}

const createSql = (f) =>
  authenticated(
    f.adminId,
    `select public.schedule_create('${f.artistId}','concert','Fictional concert',
    '2026-11-01 12:00:00+09',p_status=>'published');`,
  );

async function schedule(db, f) {
  return db.query(`begin; ${createSql(f)} commit;`);
}

const notification = (f, id, enabled) =>
  authenticated(
    f.fanId,
    `select public.schedule_set_notification('${id}',${enabled});`,
  );
const deletion = (f, id) =>
  authenticated(f.adminId, `select public.schedule_delete('${id}');`);
const optoutCount = (db, id) =>
  db.query(
    `select count(*) from public.schedule_notification_optouts where schedule_id='${id}';`,
  );

async function testConcurrency(db) {
  const f = await fixture(db);

  // Same identity and desired state must not toggle or create duplicate rows.
  const duplicateId = await schedule(db, f);
  const duplicate = await race(
    db,
    'duplicate-optout',
    notification(f, duplicateId, false),
    notification(f, duplicateId, false),
  );
  assert.equal(duplicate.winner, 'f');
  assert.equal(duplicate.following.error, undefined);
  assert.equal(duplicate.following.value, 'f');
  assert.equal(await optoutCount(db, duplicateId), '1');
  assert.equal(
    await db.query(`select user_id from public.schedule_notification_optouts
    where schedule_id='${duplicateId}';`),
    f.fanId,
  );
  console.info(
    'PASS: concurrent duplicate opt-out remains one identity-bound row',
  );

  // Opposite desired states serialize: later successful enable removes opt-out.
  const enabledId = await schedule(db, f);
  const enabled = await race(
    db,
    'disable-then-enable',
    notification(f, enabledId, false),
    notification(f, enabledId, true),
  );
  assert.equal(enabled.winner, 'f');
  assert.equal(enabled.following.error, undefined);
  assert.equal(enabled.following.value, 't');
  assert.equal(await optoutCount(db, enabledId), '0');
  console.info(
    'PASS: overlapping disable then enable follows committed lock order',
  );

  // Deletion wins first. A waiting preference request must recheck existence
  // after obtaining the target lock, rather than leave an orphan or succeed.
  const deletedId = await schedule(db, f);
  const deleted = await race(
    db,
    'delete-before-optout',
    deletion(f, deletedId),
    notification(f, deletedId, false),
  );
  assert.match(deleted.following.error?.message ?? '', /FORBIDDEN|UNAVAILABLE/);
  assert.equal(
    await db.query(
      `select count(*) from public.schedules where id='${deletedId}';`,
    ),
    '0',
  );
  assert.equal(await optoutCount(db, deletedId), '0');
  console.info(
    'PASS: deletion winning target lock denies pending opt-out without orphan',
  );

  // Preference wins first. The pending administrative delete must remove both
  // event and preference via the same transaction's FK cascade.
  const cleanupId = await schedule(db, f);
  const cleanup = await race(
    db,
    'optout-before-delete',
    notification(f, cleanupId, false),
    deletion(f, cleanupId),
  );
  assert.equal(cleanup.winner, 'f');
  assert.equal(cleanup.following.error, undefined);
  assert.equal(
    await db.query(
      `select count(*) from public.schedules where id='${cleanupId}';`,
    ),
    '0',
  );
  assert.equal(await optoutCount(db, cleanupId), '0');
  console.info(
    'PASS: deletion following opt-out atomically removes its preference',
  );

  // Artist status is authoritative after the SHARE lock. Pausing an artist
  // must deny the already-started preference operation once it resumes.
  const pausedId = await schedule(db, f);
  const paused = await race(
    db,
    'pause-before-optout',
    `update public.artists set status='paused' where id='${f.artistId}';`,
    notification(f, pausedId, false),
  );
  assert.match(paused.following.error?.message ?? '', /FORBIDDEN|UNAVAILABLE/);
  assert.equal(await optoutCount(db, pausedId), '0');
  await db.query(
    `update public.artists set status='active' where id='${f.artistId}';`,
  );
  console.info('PASS: artist pause winning its lock prevents pending opt-out');

  // Distinct administrators do not share the actor-profile lock. The artist
  // lock must serialize insertion of an initially absent editorial date, so
  // the second audit record describes an update with the committed old topic.
  const calendar = await race(
    db,
    'same-calendar-date',
    authenticated(
      f.adminId,
      `select public.content_calendar_upsert(
      '${f.artistId}','2026-11-02','First topic');`,
    ),
    authenticated(
      f.secondAdminId,
      `select public.content_calendar_upsert(
      '${f.artistId}','2026-11-02','Second topic');`,
    ),
  );
  assert.equal(calendar.following.error, undefined);
  assert.equal(calendar.following.value, calendar.winner);
  assert.equal(
    await db.query(`select count(*) from public.content_calendar
    where artist_id='${f.artistId}' and date='2026-11-02';`),
    '1',
  );
  assert.equal(
    await db.query(`select topic from public.content_calendar
    where id='${calendar.winner}';`),
    'Second topic',
  );
  assert.equal(
    await db.query(`select count(*) from public.calendar_audit_log
    where target_type='content_calendar' and target_id='${calendar.winner}';`),
    '2',
  );
  assert.equal(
    await db.query(`select count(*) from public.calendar_audit_log
    where target_type='content_calendar' and target_id='${calendar.winner}'
      and action='create' and actor_id='${f.adminId}'
      and before_data is null and after_data->>'topic'='First topic';`),
    '1',
  );
  assert.equal(
    await db.query(`select count(*) from public.calendar_audit_log
    where target_type='content_calendar' and target_id='${calendar.winner}'
      and action='update' and actor_id='${f.secondAdminId}'
      and before_data->>'topic'='First topic' and after_data->>'topic'='Second topic';`),
    '1',
  );
  console.info(
    'PASS: concurrent calendar upserts preserve one identity and accurate create/update audit snapshots',
  );

  // Revoke an administrator while its CRUD request is already waiting for the
  // actor lock. Cached JWT/profile role must not authorize the subsequent write.
  const before = await db.query('select count(*) from public.schedules;');
  const revoked = await race(
    db,
    'revoke-before-create',
    `update public.profiles set role='fan' where id='${f.adminId}';`,
    createSql(f),
  );
  assert.match(revoked.following.error?.message ?? '', /FORBIDDEN|UNAVAILABLE/);
  assert.equal(
    await db.query('select count(*) from public.schedules;'),
    before,
  );
  console.info(
    'PASS: administrator role revocation prevents pending schedule creation',
  );
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
      (select count(*) from public.subscriptions) +
      (select count(*) from public.payment_events) +
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
    'All seven PostgreSQL multi-session schedule concurrency checks passed.',
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
