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
    this.label = `points-concurrency-${label}`;
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
    const marker = `POINTS_TEST_DONE_${++commandSequence}`;
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
async function race(db, label, firstSql, secondSql, finalize = 'commit') {
  const first = await session(`${label}-first`);
  const second = await session(`${label}-second`);
  try {
    const winner = await first.query(`begin; ${firstSql}`);
    const following = second.query(`begin; ${secondSql} commit;`).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await waitForBlock(db, second, first);
    assert.ok(finalize === 'commit' || finalize === 'rollback');
    await first.query(`${finalize};`);
    return { winner, following: await following };
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
}

async function identity(db, role = 'fan', id = uuid()) {
  await db.query(`
    insert into auth.users(id,email,raw_user_meta_data)
      values ('${id}','points-${id}@example.invalid','{}');
    update public.profiles set call_name='Fictional points user',
      onboarding_completed_at=statement_timestamp(),role='${role}' where id='${id}';
  `);
  return id;
}

async function fixture(db) {
  const adminId = await identity(db, 'admin');
  const secondAdminId = await identity(db, 'admin');
  const artistId = uuid();
  await db.query(`
    insert into public.artists(id,slug,name,grade,status)
      values ('${artistId}','points-concurrency-${artistId}','Fictional points artist','B','active');
    insert into private.community_policy(version,max_title_length,max_body_length,max_comment_length,max_reason_length,
      max_images,max_image_bytes,max_image_long_edge,auto_hide_report_count,rate_window_seconds,
      max_contributions_per_window,max_reports_per_window,forbidden_terms,forbidden_patterns)
      values ('fictional-community-v1',100,1000,100,100,3,10485760,2048,3,60,100,100,array[]::text[],array[]::text[]);
    insert into private.point_policy(version,attendance_amount,post_amount,comment_amount,
      post_daily_cap,comment_daily_cap,deleted_content_treatment)
      values ('fictional-points-v1',10,20,5,null,null,'retain');
  `);
  return { adminId, secondAdminId, artistId };
}

const attendance = (userId) =>
  authenticated(userId, 'select public.point_check_attendance();');
const post = (userId, artistId, requestId = uuid()) =>
  authenticated(
    userId,
    `select public.community_create_post('${artistId}','${requestId}','Fictional title','Fictional body');`,
  );
const comment = (userId, postId, requestId = uuid()) =>
  authenticated(
    userId,
    `select public.community_create_comment('${postId}','${requestId}','Fictional comment');`,
  );
const adjust = (adminId, userId, amount, requestId = uuid()) =>
  authenticated(
    adminId,
    `select public.point_admin_adjust('${userId}','${requestId}',${amount},'Fictional audited correction');`,
  );
const execute = (db, sql) => db.query(`begin; ${sql} commit;`);
const ledgerCount = (db, userId, reason) =>
  db.query(`select count(*) from private.point_ledger
    where user_id='${userId}'${reason ? ` and reason='${reason}'` : ''};`);
const balance = (db, userId) =>
  db.query(
    `select coalesce(sum(amount),0) from private.point_ledger where user_id='${userId}';`,
  );

async function testConcurrency(db) {
  const f = await fixture(db);

  // Same day and actor resolve to one immutable source identity.
  const attendanceUser = await identity(db);
  const sameAttendance = await race(
    db,
    'same-attendance',
    attendance(attendanceUser),
    attendance(attendanceUser),
  );
  assert.equal(sameAttendance.following.error, undefined);
  assert.equal(sameAttendance.following.value, sameAttendance.winner);
  assert.equal(await ledgerCount(db, attendanceUser, 'attendance'), '1');
  assert.equal(await balance(db, attendanceUser), '10');
  console.info(
    'PASS: concurrent daily attendance awards one canonical ledger entry',
  );

  // Existing community idempotency must cover its newly transactional reward.
  const postUser = await identity(db);
  const repeatedPost = post(postUser, f.artistId, uuid());
  const samePost = await race(db, 'same-post', repeatedPost, repeatedPost);
  assert.equal(samePost.following.error, undefined);
  assert.equal(samePost.following.value, samePost.winner);
  assert.equal(await ledgerCount(db, postUser, 'post'), '1');
  assert.equal(await balance(db, postUser), '20');
  assert.equal(
    await db.query(
      `select count(*) from public.posts where user_id='${postUser}';`,
    ),
    '1',
  );
  console.info(
    'PASS: concurrent replay creates one post and one reward together',
  );

  // Both content actions persist, but only the first explicit daily slot pays.
  await db.query('update private.point_policy set post_daily_cap=1;');
  const postCapUser = await identity(db);
  const cappedPosts = await race(
    db,
    'post-cap',
    post(postCapUser, f.artistId),
    post(postCapUser, f.artistId),
  );
  assert.equal(cappedPosts.following.error, undefined);
  assert.notEqual(cappedPosts.following.value, cappedPosts.winner);
  assert.equal(await ledgerCount(db, postCapUser, 'post'), '2');
  assert.equal(await balance(db, postCapUser), '20');
  assert.equal(
    await db.query(
      `select count(*) from private.point_ledger where user_id='${postCapUser}' and amount=0;`,
    ),
    '1',
  );
  assert.equal(
    await db.query(
      `select count(*) from public.posts where user_id='${postCapUser}';`,
    ),
    '2',
  );
  await db.query('update private.point_policy set post_daily_cap=null;');
  console.info(
    'PASS: concurrent distinct posts cannot bypass an explicitly configured daily cap',
  );

  const commentUser = await identity(db);
  const repeatedComment = comment(commentUser, samePost.winner, uuid());
  const sameComment = await race(
    db,
    'same-comment',
    repeatedComment,
    repeatedComment,
  );
  assert.equal(sameComment.following.error, undefined);
  assert.equal(sameComment.following.value, sameComment.winner);
  assert.equal(await ledgerCount(db, commentUser, 'comment'), '1');
  assert.equal(await balance(db, commentUser), '5');
  assert.equal(
    await db.query(
      `select count(*) from public.comments where user_id='${commentUser}';`,
    ),
    '1',
  );
  console.info(
    'PASS: concurrent replay creates one comment and one reward together',
  );

  await db.query('update private.point_policy set comment_daily_cap=1;');
  const commentCapUser = await identity(db);
  const cappedComments = await race(
    db,
    'comment-cap',
    comment(commentCapUser, samePost.winner),
    comment(commentCapUser, samePost.winner),
  );
  assert.equal(cappedComments.following.error, undefined);
  assert.notEqual(cappedComments.following.value, cappedComments.winner);
  assert.equal(await ledgerCount(db, commentCapUser, 'comment'), '2');
  assert.equal(await balance(db, commentCapUser), '5');
  assert.equal(
    await db.query(
      `select count(*) from private.point_ledger where user_id='${commentCapUser}' and amount=0;`,
    ),
    '1',
  );
  assert.equal(
    await db.query(
      `select count(*) from public.comments where user_id='${commentCapUser}';`,
    ),
    '2',
  );
  await db.query('update private.point_policy set comment_daily_cap=null;');
  console.info(
    'PASS: concurrent distinct comments cannot bypass an explicitly configured daily cap',
  );

  // Distinct admins must serialize on the shared target rather than merely
  // their separate actor profiles; both deductions cannot spend the same total.
  const deductionUser = await identity(db);
  await execute(db, adjust(f.adminId, deductionUser, 10));
  const deductions = await race(
    db,
    'competing-deductions',
    adjust(f.adminId, deductionUser, -7),
    adjust(f.secondAdminId, deductionUser, -7),
  );
  assert.match(
    deductions.following.error?.message ?? '',
    /POINT.*BALANCE|POINT.*NEGATIVE|POINT.*INSUFFICIENT/,
  );
  assert.equal(await balance(db, deductionUser), '3');
  assert.equal(await ledgerCount(db, deductionUser, 'admin_adjust'), '2');
  console.info(
    'PASS: concurrent administrator deductions preserve a nonnegative ledger balance',
  );

  const correctionUser = await identity(db);
  const repeatedAdjustment = adjust(f.adminId, correctionUser, 11, uuid());
  const sameCorrection = await race(
    db,
    'same-correction',
    repeatedAdjustment,
    repeatedAdjustment,
  );
  assert.equal(sameCorrection.following.error, undefined);
  assert.equal(sameCorrection.following.value, sameCorrection.winner);
  assert.equal(await balance(db, correctionUser), '11');
  assert.equal(await ledgerCount(db, correctionUser, 'admin_adjust'), '1');
  console.info(
    'PASS: concurrent correction replay retains one audited immutable effect',
  );

  const firstTarget = await identity(db);
  const otherTarget = await identity(db);
  const correctionRequest = uuid();
  const reusedCorrection = await race(
    db,
    'correction-target-conflict',
    adjust(f.adminId, firstTarget, 7, correctionRequest),
    adjust(f.adminId, otherTarget, 7, correctionRequest),
  );
  assert.match(
    reusedCorrection.following.error?.message ?? '',
    /IDEMPOTENCY_CONFLICT/,
  );
  assert.equal(await balance(db, firstTarget), '7');
  assert.equal(await ledgerCount(db, otherTarget), '0');
  console.info(
    'PASS: overlapping correction request reuse for another target conflicts without credit',
  );

  // Permission must be rechecked after the wait using current profile data.
  const restrictedUser = await identity(db);
  const restriction = await race(
    db,
    'restrict-before-attendance',
    `update public.profiles set is_restricted=true,restricted_until=clock_timestamp()+interval '1 hour' where id='${restrictedUser}';`,
    attendance(restrictedUser),
  );
  assert.match(
    restriction.following.error?.message ?? '',
    /FORBIDDEN|UNAVAILABLE/,
  );
  assert.equal(await ledgerCount(db, restrictedUser), '0');
  console.info(
    'PASS: a committed restriction denies an already waiting attendance request',
  );

  const revokedTarget = await identity(db);
  const revocation = await race(
    db,
    'revoke-before-correction',
    `update public.profiles set role='fan' where id='${f.secondAdminId}';`,
    adjust(f.secondAdminId, revokedTarget, 7),
  );
  assert.match(
    revocation.following.error?.message ?? '',
    /FORBIDDEN|UNAVAILABLE/,
  );
  assert.equal(await ledgerCount(db, revokedTarget), '0');
  console.info(
    'PASS: administrator revocation denies an already waiting correction',
  );

  const pausedUser = await identity(db);
  const pause = await race(
    db,
    'pause-before-post',
    `update public.artists set status='paused' where id='${f.artistId}';`,
    post(pausedUser, f.artistId),
  );
  assert.match(pause.following.error?.message ?? '', /FORBIDDEN|UNAVAILABLE/);
  assert.equal(await ledgerCount(db, pausedUser), '0');
  assert.equal(
    await db.query(
      `select count(*) from public.posts where user_id='${pausedUser}';`,
    ),
    '0',
  );
  await db.query(
    `update public.artists set status='active' where id='${f.artistId}';`,
  );
  console.info(
    'PASS: artist pause rejects pending content and its reward atomically',
  );

  // The selected policy snapshot is locked, not fetched once before waiting.
  const policyUser = await identity(db);
  const policyFirst = await race(
    db,
    'policy-before-attendance',
    "update private.point_policy set version='fictional-points-v2',attendance_amount=17;",
    attendance(policyUser),
  );
  assert.equal(policyFirst.following.error, undefined);
  assert.equal(await balance(db, policyUser), '17');
  assert.equal(
    await db.query(
      `select policy_version from private.point_ledger where user_id='${policyUser}';`,
    ),
    'fictional-points-v2',
  );
  console.info(
    'PASS: a waiting attendance request applies the newly committed policy snapshot',
  );

  const oldPolicyUser = await identity(db);
  const attendanceFirst = await race(
    db,
    'attendance-before-policy',
    attendance(oldPolicyUser),
    "update private.point_policy set version='fictional-points-v3',attendance_amount=19;",
  );
  assert.equal(attendanceFirst.following.error, undefined);
  assert.equal(await balance(db, oldPolicyUser), '17');
  assert.equal(
    await db.query(
      `select policy_version from private.point_ledger where user_id='${oldPolicyUser}';`,
    ),
    'fictional-points-v2',
  );
  assert.equal(
    await db.query('select version from private.point_policy;'),
    'fictional-points-v3',
  );
  console.info(
    'PASS: a reward winning the policy lock preserves its original applied snapshot',
  );

  // Deletion retains the original effect; replay does not restore or reward it.
  const deletion = await race(
    db,
    'delete-before-replay',
    authenticated(
      postUser,
      `select public.community_delete('post','${samePost.winner}');`,
    ),
    repeatedPost,
  );
  assert.equal(deletion.following.error, undefined);
  assert.equal(deletion.following.value, samePost.winner);
  assert.equal(await ledgerCount(db, postUser, 'post'), '1');
  assert.equal(await balance(db, postUser), '20');
  assert.equal(
    await db.query(
      `select deleted_at is not null from public.posts where id='${samePost.winner}';`,
    ),
    't',
  );
  console.info(
    'PASS: delete/replay interleaving retains the one original reward without restoring content',
  );

  // A response from a transaction later rolled back is not a committed effect.
  const rollbackUser = await identity(db);
  const rolledBack = await race(
    db,
    'rollback-before-attendance',
    attendance(rollbackUser),
    attendance(rollbackUser),
    'rollback',
  );
  assert.equal(rolledBack.following.error, undefined);
  assert.notEqual(rolledBack.following.value, rolledBack.winner);
  assert.equal(await ledgerCount(db, rollbackUser, 'attendance'), '1');
  assert.equal(await balance(db, rollbackUser), '19');
  console.info(
    'PASS: a rolled-back first attendance leaves no poisoned idempotency claim',
  );

  // Cross-RPC regression: before its lock-order repair, set_profile_role held
  // the higher actor UUID while waiting on the lower target. A correction in
  // the transaction already owning that lower target then deadlocked on actor.
  // Merely running two complete operations through race() cannot reproduce it.
  const [lowerTarget, higherAdmin] = [uuid(), uuid()].sort();
  await identity(db, 'fan', lowerTarget);
  await identity(db, 'admin', higherAdmin);
  const correctionRequestId = uuid();
  const correctionSession = await session('cross-rpc-correction');
  const roleSession = await session('cross-rpc-role');
  try {
    await correctionSession.query(`begin;
      select id from public.profiles where id='${lowerTarget}' for update;`);
    const pendingRoleChange = roleSession
      .query(
        `begin; ${authenticated(
          higherAdmin,
          `select public.set_profile_role('${lowerTarget}','fan');`,
        )} commit;`,
      )
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    await waitForBlock(db, roleSession, correctionSession);
    const correctionId = await correctionSession.query(
      `${adjust(higherAdmin, lowerTarget, 5, correctionRequestId)} commit;`,
    );
    const changedRole = await pendingRoleChange;
    assert.equal(changedRole.error, undefined);
    assert.match(correctionId, /^[0-9a-f-]{36}$/);
    assert.equal(await ledgerCount(db, lowerTarget, 'admin_adjust'), '1');
    assert.equal(await balance(db, lowerTarget), '5');
    assert.equal(
      await db.query(
        `select role from public.profiles where id='${lowerTarget}';`,
      ),
      'fan',
    );
    assert.equal(
      await execute(
        db,
        authenticated(
          lowerTarget,
          'select ref_id from public.point_history();',
        ),
      ),
      correctionRequestId,
      'safe history must not expose the correcting administrator UUID',
    );
  } finally {
    await Promise.all([correctionSession.close(), roleSession.close()]);
  }
  console.info(
    'PASS: role administration and corrections share canonical profile lock order without deadlock',
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
      (select count(*) from public.artist_members) +
      (select count(*) from public.subscriptions) +
      (select count(*) from public.payment_events) +
      (select count(*) from private.payment_mandates) +
      (select count(*) from private.billing_obligations) +
      (select count(*) from private.payment_attempts) +
      (select count(*) from private.payment_event_verifications) +
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
      (select count(*) from private.point_policy) +
      (select count(*) from private.point_ledger) +
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
    'All sixteen PostgreSQL multi-session points concurrency checks passed.',
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
