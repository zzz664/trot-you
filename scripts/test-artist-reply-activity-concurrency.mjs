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
    this.label = `artist-reply-activity-concurrency-${label}`;
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
    const marker = `ARTIST_ACTIVITY_TEST_DONE_${++commandSequence}`;
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
  const artistId = uuid(),
    authorId = uuid(),
    fanId = uuid(),
    subId = uuid(),
    messageId = uuid(),
    replyId = uuid();
  const slug = `activity-race-${artistId}`;
  await db.query(`
    insert into auth.users(id,email,raw_user_meta_data) values
      ('${authorId}','activity-author@example.invalid','{}'),('${fanId}','activity-fan@example.invalid','{}');
    update public.profiles set call_name='가상 이름',onboarding_completed_at=now() where id in('${authorId}','${fanId}');
    update public.profiles set role='artist' where id='${authorId}';
    insert into public.artists(id,slug,name,grade,status) values('${artistId}','${slug}','허구 활동 경합 가수','B','active');
    insert into public.artist_members(artist_id,user_id) values('${artistId}','${authorId}');
    insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end)
      values('${subId}','${fanId}','${artistId}','toss','expired',now()-interval '2 days',now()-interval '2 days',now()-interval '2 days',now()-interval '1 day');
    insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
      values('${messageId}','${artistId}','${authorId}','text','허구 활동 본문','sent',now()-interval '1 second',now()-interval '1 second');
    insert into public.replies(id,user_id,artist_id,subscription_id,body,message_id,created_at)
      values('${replyId}','${fanId}','${artistId}','${subId}','허구 받은 답장','${messageId}',now());
  `);
  return { artistId, authorId, fanId, subId, messageId, replyId, slug };
}
const read = (f, filtered = false) =>
  authenticated(
    f.authorId,
    `select public.artist_reply_activity_context('${f.slug}'${filtered ? `,'${f.messageId}'` : ''});`,
  );
function expectError(result, code) {
  assert.ok(result.following.error, `expected ${code}`);
  assert.match(String(result.following.error), new RegExp(code));
  assert.doesNotMatch(
    String(result.following.error),
    /deadlock detected|lock timeout|statement timeout/,
  );
}
function expectSuccess(result) {
  assert.equal(result.following.error, undefined);
  return JSON.parse(result.following.value);
}
async function testConcurrency(db) {
  const f = await fixture(db);
  let result = await race(
    db,
    'restriction-before-read',
    `update public.profiles set is_restricted=true where id='${f.authorId}';`,
    read(f),
  );
  expectError(result, 'ARTIST_REPLY_FORBIDDEN');
  await db.query(
    `update public.profiles set is_restricted=false where id='${f.authorId}';`,
  );
  console.info(
    'PASS: committed artist restriction is rechecked after a real profile lock wait',
  );

  result = await race(
    db,
    'read-before-restriction',
    read(f),
    `update public.profiles set is_restricted=true where id='${f.authorId}'; select 'restricted';`,
  );
  assert.equal(result.following.error, undefined);
  assert.equal(JSON.parse(result.winner).replies.length, 1);
  await db.query(
    `update public.profiles set is_restricted=false where id='${f.authorId}';`,
  );
  console.info(
    'PASS: an earlier authorized read serializes before restriction, without promising recalled browser text',
  );

  result = await race(
    db,
    'membership-before-read',
    `delete from public.artist_members where user_id='${f.authorId}' and artist_id='${f.artistId}';`,
    read(f),
  );
  expectError(result, 'ARTIST_REPLY_FORBIDDEN');
  await db.query(
    `insert into public.artist_members(artist_id,user_id) values('${f.artistId}','${f.authorId}');`,
  );
  console.info(
    'PASS: membership deletion invalidates an in-flight waiting read',
  );

  result = await race(
    db,
    'pause-before-read',
    `update public.artists set status='paused' where id='${f.artistId}';`,
    read(f),
  );
  expectError(result, 'ARTIST_REPLY_NOT_FOUND');
  await db.query(
    `update public.artists set status='active' where id='${f.artistId}';`,
  );
  console.info('PASS: artist status is rechecked after its row lock wait');

  result = await race(
    db,
    'role-before-read',
    `update public.profiles set role='fan' where id='${f.authorId}';`,
    read(f),
  );
  expectError(result, 'ARTIST_REPLY_FORBIDDEN');
  await db.query(`update public.profiles set role='artist' where id='${f.authorId}';
    insert into public.artist_members(artist_id,user_id) values('${f.artistId}','${f.authorId}');`);
  console.info(
    'PASS: role downgrade and automatic membership revocation block artist reads',
  );

  result = await race(
    db,
    'cancel-before-filter',
    `update public.messages set status='canceled',canceled_at=clock_timestamp() where id='${f.messageId}';`,
    read(f, true),
  );
  expectError(result, 'ARTIST_REPLY_NOT_FOUND');
  const afterCancel = JSON.parse(await db.query(`begin; ${read(f)} commit;`));
  assert.equal(afterCancel.replies.length, 1);
  assert.equal(afterCancel.replies[0].message_id, null);
  await db.query(
    `update public.messages set status='sent',canceled_at=null where id='${f.messageId}';`,
  );
  console.info(
    'PASS: canceled selected message is rejected after wait while received reply keeps no stale link',
  );

  // Owner-only synthetic updates hold the artist gate to make the fresh snapshot
  // point observable. These are not new moderation APIs and never lock a fan
  // after the read path's artist lock (which would invert existing fan send).
  result = await race(
    db,
    'fan-restriction-before-query',
    `select id from public.artists where id='${f.artistId}' for update;
     update public.profiles set is_restricted=true where id='${f.fanId}';`,
    read(f),
  );
  assert.equal(expectSuccess(result).replies.length, 0);
  await db.query(
    `update public.profiles set is_restricted=false where id='${f.fanId}';`,
  );
  console.info(
    'PASS: fresh reply query after artist gate wait excludes newly restricted fan and name',
  );

  result = await race(
    db,
    'hide-before-query',
    `select id from public.artists where id='${f.artistId}' for update;
     update public.replies set is_blocked=true where id='${f.replyId}';`,
    read(f),
  );
  assert.equal(expectSuccess(result).replies.length, 0);
  await db.query(
    `update public.replies set is_blocked=false where id='${f.replyId}';`,
  );
  console.info(
    'PASS: committed blocked reply never leaks through a previously started waiting context',
  );

  const added = uuid();
  result = await race(
    db,
    'publication-before-count',
    `select id from public.artists where id='${f.artistId}' for update;
     insert into public.messages(id,artist_id,author_id,type,status,scheduled_at,sent_at)
       values('${added}','${f.artistId}','${f.authorId}','photo','sent',clock_timestamp(),clock_timestamp());`,
    read(f),
  );
  const afterPublish = expectSuccess(result);
  assert.equal(afterPublish.activity.photo_count, 1);
  assert.equal(
    afterPublish.activity.message_count,
    Number(
      await db.query(`select count(*) from public.messages
    where artist_id='${f.artistId}' and status='sent' and sent_at>='${afterPublish.activity.week_start}'::timestamp at time zone 'Asia/Seoul'
    and sent_at<='${afterPublish.server_now}'::timestamptz;`),
    ),
  );
  console.info(
    'PASS: publication committed before query is included in the consistent KST as-of source count',
  );

  result = await race(
    db,
    'cancel-before-count',
    `select id from public.artists where id='${f.artistId}' for update;
     update public.messages set status='canceled',canceled_at=clock_timestamp() where id='${added}';`,
    read(f),
  );
  assert.equal(expectSuccess(result).activity.photo_count, 0);
  console.info(
    'PASS: canceled photo source disappears from live activity without editing any settlement',
  );

  result = await race(
    db,
    'name-before-query',
    `select id from public.artists where id='${f.artistId}' for update;
     update public.profiles set call_name='새 가상 이름' where id='${f.fanId}';`,
    read(f),
  );
  const renamed = expectSuccess(result);
  assert.equal(renamed.replies[0].call_name, '새 가상 이름');
  assert.deepEqual(Object.keys(renamed.replies[0]).sort(), [
    'body',
    'call_name',
    'created_at',
    'id',
    'message_id',
  ]);
  console.info(
    'PASS: current calling-name update appears without fan UUID or profile metadata',
  );

  const a = await session('rollback-gate'),
    b = await session('rollback-reader');
  try {
    await a.query(
      `begin; update public.profiles set is_restricted=true where id='${f.authorId}';`,
    );
    const following = b.query(`begin; ${read(f)} commit;`);
    await waitForBlock(db, b, a);
    await a.query('rollback;');
    assert.equal(JSON.parse(await following).replies.length, 1);
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
  console.info(
    'PASS: rolled-back access change leaves no false permanent denial',
  );

  const isolation = await session('stale-isolation');
  try {
    await assert.rejects(
      isolation.query(
        `begin isolation level repeatable read; ${read(f)} commit;`,
      ),
      /ARTIST_REPLY_ISOLATION_UNSUPPORTED/,
    );
  } finally {
    await isolation.close();
  }
  console.info(
    'PASS: stale repeatable-read transaction cannot bypass current-access snapshot semantics',
  );
  assert.equal(
    await db.query(
      `select (select count(*) from public.payment_events)+(select count(*) from public.settlements)+(select count(*) from private.notification_jobs);`,
    ),
    '0',
  );
}
try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(`select
    (select count(*) from auth.users)+(select count(*) from public.profiles)+
    (select count(*) from public.subscriptions)+(select count(*) from public.payment_events)+
    (select count(*) from public.messages)+(select count(*) from public.replies)+
    (select count(*) from private.settlement_policies)+(select count(*) from public.settlements)+
    (select count(*) from public.artists where id not in('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'));`),
    '0',
    'Use a freshly reset disposable local database with fictional seeds only; this test resets it afterward.',
  );
  shouldReset = true;
  await testConcurrency(db);
  console.info(
    'All artist reply/activity PostgreSQL multi-session concurrency checks passed.',
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.all([...clients].map((client) => client.close()));
  if (shouldReset) {
    try {
      console.info(
        'Restoring disposable local database after committed fixtures.',
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
