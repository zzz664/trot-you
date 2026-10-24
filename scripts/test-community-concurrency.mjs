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
    this.label = `community-concurrency-${label}`;
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
    const marker = `COMMUNITY_TEST_DONE_${++commandSequence}`;
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
  const authorId = uuid();
  const fanId = uuid();
  const reporterId = uuid();
  const adminId = uuid();
  const artistId = uuid();
  await db.query(`
    insert into auth.users(id,email,raw_user_meta_data) values
      ('${authorId}','community-author@example.invalid','{}'),
      ('${fanId}','community-fan@example.invalid','{}'),
      ('${reporterId}','community-reporter@example.invalid','{}'),
      ('${adminId}','community-admin@example.invalid','{}');
    update public.profiles set call_name='Fictional community fan',
      onboarding_completed_at=statement_timestamp() where id in
      ('${authorId}','${fanId}','${reporterId}','${adminId}');
    update public.profiles set role='admin' where id='${adminId}';
    insert into public.artists(id,slug,name,grade,status)
      values ('${artistId}','community-concurrency-${artistId}','Fictional community artist','B','active');
    insert into private.community_policy(version,max_title_length,max_body_length,max_comment_length,max_reason_length,
  max_images,max_image_bytes,max_image_long_edge,auto_hide_report_count,rate_window_seconds,
  max_contributions_per_window,max_reports_per_window,forbidden_terms,forbidden_patterns)
values ('fictional-test-policy-v1',100,1000,100,100,3,10485760,2048,3,60,100,100,array['blockedword'],array['[0-9]{3}-[0-9]{4}-[0-9]{4}']);
  `);
  return { authorId, fanId, reporterId, adminId, artistId };
}

async function post(db, f) {
  return db.query(
    `begin; ${authenticated(
      f.authorId,
      `select public.community_create_post('${f.artistId}','${uuid()}','Fictional title','Fictional body');`,
    )} commit;`,
  );
}

const like = (f, id, liked = true) =>
  authenticated(f.fanId, `select public.community_set_like('${id}',${liked});`);
const report = (actor, id) =>
  authenticated(
    actor,
    `select public.community_report('post','${id}','Fictional reason');`,
  );

async function testConcurrency(db) {
  const f = await fixture(db);

  // 1. Same creation request cannot allocate two rows, even before either caller
  // sees a committed result. The shared author profile row lock must genuinely block.
  const requestId = uuid();
  const createSql = authenticated(
    f.authorId,
    `select public.community_create_post('${f.artistId}','${requestId}','Fictional title','Fictional body');`,
  );
  const duplicatePost = await race(db, 'duplicate-post', createSql, createSql);
  assert.equal(duplicatePost.following.error, undefined);
  assert.equal(duplicatePost.winner, duplicatePost.following.value);
  assert.equal(
    await db.query(
      `select count(*) from public.posts where request_id='${requestId}';`,
    ),
    '1',
  );
  console.info('PASS: concurrent duplicate post request creates one identity');

  // 2. Duplicate comment requests serialize on actor/parent and count exactly once.
  const commentPost = await post(db, f);
  const commentRequest = uuid();
  const commentSql = authenticated(
    f.fanId,
    `select public.community_create_comment('${commentPost}','${commentRequest}','Fictional comment');`,
  );
  const duplicateComment = await race(
    db,
    'duplicate-comment',
    commentSql,
    commentSql,
  );
  assert.equal(duplicateComment.following.error, undefined);
  assert.equal(duplicateComment.winner, duplicateComment.following.value);
  assert.equal(
    await db.query(
      `select comment_count from public.posts where id='${commentPost}';`,
    ),
    '1',
  );
  assert.equal(
    await db.query(
      `select count(*) from public.comments where post_id='${commentPost}';`,
    ),
    '1',
  );
  console.info(
    'PASS: concurrent duplicate comment request increments parent once',
  );

  // 3. Desired-state likes are not unsafe read-then-toggle operations.
  const likePost = await post(db, f);
  const liked = await race(
    db,
    'duplicate-like',
    like(f, likePost),
    like(f, likePost),
  );
  assert.equal(liked.winner, 't');
  assert.equal(liked.following.error, undefined);
  assert.equal(liked.following.value, 't');
  assert.equal(
    await db.query(
      `select like_count from public.posts where id='${likePost}';`,
    ),
    '1',
  );
  assert.equal(
    await db.query(
      `select count(*) from public.post_likes where post_id='${likePost}';`,
    ),
    '1',
  );
  console.info(
    'PASS: concurrent duplicate desired-state like leaves one row and count',
  );

  // 4. Duplicate removals cannot underflow or recreate a like.
  const unliked = await race(
    db,
    'duplicate-unlike',
    like(f, likePost, false),
    like(f, likePost, false),
  );
  assert.equal(unliked.winner, 'f');
  assert.equal(unliked.following.error, undefined);
  assert.equal(unliked.following.value, 'f');
  assert.equal(
    await db.query(
      `select like_count from public.posts where id='${likePost}';`,
    ),
    '0',
  );
  assert.equal(
    await db.query(
      `select count(*) from public.post_likes where post_id='${likePost}';`,
    ),
    '0',
  );
  console.info('PASS: concurrent unlike removal cannot decrement twice');

  // 5. A single identity cannot inflate distinct reports through concurrent calls.
  const reportPost = await post(db, f);
  const duplicateReport = await race(
    db,
    'duplicate-report',
    report(f.fanId, reportPost),
    report(f.fanId, reportPost),
  );
  assert.equal(duplicateReport.following.error, undefined);
  assert.equal(duplicateReport.winner, duplicateReport.following.value);
  assert.equal(
    await db.query(
      `select report_count from public.posts where id='${reportPost}';`,
    ),
    '1',
  );
  assert.equal(
    await db.query(
      `select count(*) from public.reports where target_id='${reportPost}';`,
    ),
    '1',
  );
  console.info('PASS: concurrent reports by one identity count once');

  // 6. Different reporters must not lose increments or miss threshold hiding.
  // One previous report means these two new, distinct reports cross threshold 3.
  const distinctReports = await race(
    db,
    'distinct-reports',
    report(f.reporterId, reportPost),
    report(f.adminId, reportPost),
  );
  assert.equal(distinctReports.following.error, undefined);
  assert.notEqual(distinctReports.winner, distinctReports.following.value);
  assert.equal(
    await db.query(
      `select report_count::text||':'||is_hidden::text from public.posts where id='${reportPost}';`,
    ),
    '3:true',
  );
  assert.equal(
    await db.query(
      `select count(*) from public.reports where target_id='${reportPost}' and status='hidden';`,
    ),
    '3',
  );
  console.info(
    'PASS: distinct concurrent reports atomically cross the auto-hide threshold',
  );

  // 7. Hiding a comment then deleting it must not decrement visible count twice.
  const hiddenComment = await race(
    db,
    'hide-then-delete-comment',
    authenticated(
      f.adminId,
      `select public.community_moderate('comment','${duplicateComment.winner}','hide','Fictional review');`,
    ),
    authenticated(
      f.fanId,
      `select public.community_delete('comment','${duplicateComment.winner}');`,
    ),
  );
  assert.equal(hiddenComment.following.error, undefined);
  assert.equal(
    await db.query(
      `select comment_count from public.posts where id='${commentPost}';`,
    ),
    '0',
  );
  assert.equal(
    await db.query(
      `select deleted_at is not null from public.comments where id='${duplicateComment.winner}';`,
    ),
    't',
  );
  console.info(
    'PASS: concurrent comment hide and deletion preserve visible count zero',
  );

  // 8. Restriction wins its profile lock: an already-started interaction must
  // recheck authoritative state after waiting, not trust its initial snapshot.
  const restrictedPost = await post(db, f);
  const restricted = await race(
    db,
    'restrict-before-like',
    authenticated(
      f.adminId,
      `select public.community_restrict_user('${f.fanId}',true,clock_timestamp()+interval '1 day','Fictional restriction');`,
    ),
    like(f, restrictedPost),
  );
  assert.match(
    restricted.following.error?.message ?? '',
    /FORBIDDEN|RESTRICTED/,
  );
  assert.equal(
    await db.query(
      `select like_count from public.posts where id='${restrictedPost}';`,
    ),
    '0',
  );
  await db.query(
    `begin; ${authenticated(f.adminId, `select public.community_restrict_user('${f.fanId}',false,null,'Fictional release');`)} commit;`,
  );
  console.info(
    'PASS: restriction winning the profile lock prevents pending interaction',
  );

  // 9. Board deactivation wins its artist lock and pending new likes are denied.
  const pausedPost = await post(db, f);
  const paused = await race(
    db,
    'pause-before-like',
    `update public.artists set status='paused' where id='${f.artistId}';`,
    like(f, pausedPost),
  );
  assert.match(paused.following.error?.message ?? '', /FORBIDDEN|UNAVAILABLE/);
  assert.equal(
    await db.query(
      `select like_count from public.posts where id='${pausedPost}';`,
    ),
    '0',
  );
  await db.query(
    `update public.artists set status='active' where id='${f.artistId}';`,
  );
  console.info(
    'PASS: board pause winning its lock prevents pending interaction',
  );

  // 10. A restriction that expires while its row lock is held is evaluated with
  // a fresh post-lock clock. No waiting for an arbitrary duration as a lock proof.
  const expiringPost = await post(db, f);
  const expiresAt =
    await db.query(`update public.profiles set is_restricted=true,
    restricted_until=clock_timestamp()+interval '3 seconds' where id='${f.fanId}' returning restricted_until;`);
  const expiry = await race(
    db,
    'restriction-expiry',
    `select id from public.profiles where id='${f.fanId}' for update;`,
    like(f, expiringPost),
    async (waiting) => {
      assert.equal(
        await db.query(`select query_start<'${expiresAt}'::timestamptz from pg_stat_activity
        where application_name='${waiting.label}';`),
        't',
      );
      await db.query(
        `select pg_sleep(greatest(0,extract(epoch from '${expiresAt}'::timestamptz-clock_timestamp()))+0.05);`,
      );
    },
  );
  assert.equal(expiry.following.error, undefined);
  assert.equal(expiry.following.value, 't');
  assert.equal(
    await db.query(
      `select like_count from public.posts where id='${expiringPost}';`,
    ),
    '1',
  );
  console.info(
    'PASS: restriction expiry is checked using a fresh clock after waiting',
  );

  // 11. Deletion wins its target lock and an overlapping like cannot resurrect
  // visibility or add a new relationship to a now-deleted resource.
  const deletedPost = await post(db, f);
  const deleted = await race(
    db,
    'delete-before-like',
    authenticated(
      f.authorId,
      `select public.community_delete('post','${deletedPost}');`,
    ),
    like(f, deletedPost),
  );
  assert.match(deleted.following.error?.message ?? '', /FORBIDDEN|UNAVAILABLE/);
  assert.equal(
    await db.query(
      `select like_count from public.posts where id='${deletedPost}';`,
    ),
    '0',
  );
  console.info(
    'PASS: deletion winning the target lock prevents pending interaction',
  );

  // 12. Same-actor contributions on different targets still share a profile/rate
  // lock. At a one-item quota, the waiting caller must fail rather than overshoot.
  await db.query(`update private.community_policy set max_contributions_per_window=1;
    update private.community_rate_limits set contributions=0,started_at=clock_timestamp()
      where user_id='${f.fanId}';`);
  const firstRateRequest = uuid();
  const secondRateRequest = uuid();
  const quota = await race(
    db,
    'contribution-quota',
    authenticated(
      f.fanId,
      `select public.community_create_post('${f.artistId}','${firstRateRequest}','Fictional quota','Fictional body');`,
    ),
    authenticated(
      f.fanId,
      `select public.community_create_post('${f.artistId}','${secondRateRequest}','Fictional quota','Fictional body');`,
    ),
  );
  assert.match(quota.following.error?.message ?? '', /COMMUNITY_RATE_LIMITED/);
  assert.equal(
    await db.query(
      `select count(*) from public.posts where request_id in ('${firstRateRequest}','${secondRateRequest}');`,
    ),
    '1',
  );
  assert.equal(
    await db.query(
      `select contributions from private.community_rate_limits where user_id='${f.fanId}';`,
    ),
    '1',
  );
  console.info(
    'PASS: concurrent different contributions cannot exceed actor quota',
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
    'All twelve PostgreSQL multi-session community concurrency checks passed.',
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
