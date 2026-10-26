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
let completedCases = 0;
const expectedCases = 18;

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
    this.label = `community-moderation-concurrency-${label}`;
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
    const marker = `COMMUNITY_MODERATION_TEST_DONE_${++commandSequence}`;
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
    const result = { winner, following: await following };
    completedCases += 1;
    return result;
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
}

function value(result) {
  assert.equal(result.following.error, undefined);
  return result.following.value;
}
function expectedError(result, message) {
  assert.ok(result.following.error, `expected ${message}`);
  assert.match(String(result.following.error), new RegExp(message));
  assert.doesNotMatch(
    String(result.following.error),
    /deadlock detected|lock timeout|statement timeout/,
  );
}

const report = (
  f,
  actor = f.reporter,
  operation = uuid(),
  target = f.post,
  kind = 'post',
  reason = 'Fictional report',
) =>
  authenticated(
    actor,
    `select public.community_moderation_report('${operation}','${kind}','${target}','${reason}');`,
  );
const resolve = (
  f,
  reportId,
  revision,
  decision = 'restore',
  operation = uuid(),
) =>
  authenticated(
    f.admin,
    `select public.community_moderation_resolve('${operation}','${reportId}',${revision},'${decision}','Fictional decision',true);`,
  );
const restrict = (
  f,
  stamp,
  operation = uuid(),
  until = "clock_timestamp()+interval '1 hour'",
) =>
  authenticated(
    f.admin,
    `select public.community_moderation_restrict('${operation}','${f.reporter}','${stamp}',true,${until},'Fictional restriction',true);`,
  );
const profileStamp = (db, id) =>
  db.query(`select updated_at from public.profiles where id='${id}';`);
const revision = (db, id, kind = 'post') =>
  db.query(
    `select revision from public.${kind === 'reply' ? 'replies' : 'posts'} where id='${id}';`,
  );
const committed = (db, sql) => db.query(`begin; ${sql} commit;`);
const reportId = async (db, f, actor = f.reporter) =>
  JSON.parse(await committed(db, report(f, actor))).id;
const notices = (f) =>
  authenticated(f.reporter, 'select public.community_moderation_notices();');
async function fixtures(db) {
  const f = Object.fromEntries(
    [
      'fan',
      'reporter',
      'other',
      'admin',
      'artistUser',
      'artist',
      'post',
      'reply',
      'subscription',
    ].map((key) => [key, uuid()]),
  );
  f.slug = `moderation-race-${f.artist}`;
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values
    ('${f.fan}','${f.fan}@example.invalid','{}'),('${f.reporter}','${f.reporter}@example.invalid','{}'),
    ('${f.other}','${f.other}@example.invalid','{}'),('${f.admin}','${f.admin}@example.invalid','{}'),
    ('${f.artistUser}','${f.artistUser}@example.invalid','{}');
    update public.profiles set call_name='가상신고팬',onboarding_completed_at=clock_timestamp() where id in('${f.fan}','${f.reporter}','${f.other}','${f.admin}','${f.artistUser}');
    update public.profiles set role='admin' where id='${f.admin}';
    update public.profiles set role='artist' where id='${f.artistUser}';
    insert into public.artists(id,slug,name,grade,status) values('${f.artist}','${f.slug}','Fictional moderation race artist','B','active');
    insert into public.artist_members(artist_id,user_id) values('${f.artist}','${f.artistUser}');
    insert into private.community_policy(singleton,version,max_title_length,max_body_length,max_comment_length,max_reason_length,
      max_images,max_image_bytes,max_image_long_edge,auto_hide_report_count,rate_window_seconds,max_contributions_per_window,
      max_reports_per_window,forbidden_terms,forbidden_patterns)
    values(true,'fictional-moderation-race',100,1000,100,100,3,1048576,4096,2,60,1000,1000,'{}','{}')
    on conflict(singleton) do update set auto_hide_report_count=2,max_reason_length=100,max_reports_per_window=1000,forbidden_terms='{}',forbidden_patterns='{}';
    insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end)
    values('${f.subscription}','${f.fan}','${f.artist}','toss','expired',clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day');
    insert into public.replies(id,user_id,artist_id,subscription_id,body) values('${f.reply}','${f.fan}','${f.artist}','${f.subscription}','Fictional private reply');`);
  await committed(
    db,
    authenticated(
      f.fan,
      `select public.board_ui_create('${f.slug}',gen_random_uuid(),'${f.post}','${f.artist}','Fictional moderation post','Fictional body','{}'::uuid[],false,false);`,
    ),
  );
  return f;
}
async function assertTarget(db, f, count, hidden) {
  const actual = JSON.parse(
    await db.query(`select jsonb_build_object('count',report_count,'hidden',is_hidden,
    'distinct',(select count(distinct reporter_id) from public.reports where target_type='post' and target_id=p.id)) from public.posts p where id='${f.post}';`),
  );
  assert.deepEqual(actual, { count, hidden, distinct: count });
}
async function run(db) {
  {
    const f = await fixtures(db);
    const sql = report(f);
    const result = await race(db, 'duplicate-report', sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    await assertTarget(db, f, 1, false);
    assert.equal(
      await db.query(
        `select reports from private.community_rate_limits where user_id='${f.reporter}';`,
      ),
      '1',
    );
    console.info(
      'PASS: duplicate actor operation records one distinct report and rate claim',
    );
  }
  {
    const f = await fixtures(db);
    const operation = uuid();
    const result = await race(
      db,
      'changed-report',
      report(f, f.reporter, operation),
      report(f, f.reporter, operation, f.post, 'post', 'Changed reason'),
    );
    expectedError(result, 'MODERATION_OPERATION_CONFLICT');
    await assertTarget(db, f, 1, false);
    console.info(
      'PASS: same operation cannot change an accepted report reason',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'distinct-threshold',
      report(f),
      report(f, f.other),
    );
    value(result);
    await assertTarget(db, f, 2, true);
    assert.equal(
      await db.query(
        `select count(*) from public.reports where target_id='${f.post}' and status='hidden';`,
      ),
      '2',
    );
    console.info(
      'PASS: separate reporters serialize the target and cross the approved threshold atomically',
    );
  }
  {
    const f = await fixtures(db);
    const id = await reportId(db, f);
    const sql = resolve(f, id, await revision(db, f.post));
    const result = await race(db, 'duplicate-resolution', sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    assert.equal(
      await db.query(
        `select count(*) from private.moderation_notices where report_id='${id}';`,
      ),
      '1',
    );
    assert.equal(
      await db.query(
        `select count(*) from public.community_moderation_log where target_id='${f.post}' and action='restore';`,
      ),
      '1',
    );
    console.info(
      'PASS: exact resolution retry creates one decision audit and one recipient notice',
    );
  }
  {
    const f = await fixtures(db);
    const id = await reportId(db, f);
    const rev = await revision(db, f.post);
    const result = await race(
      db,
      'stale-resolution',
      resolve(f, id, rev),
      resolve(f, id, rev, 'delete'),
    );
    expectedError(result, 'MODERATION_REPORT_RESOLVED');
    assert.equal(
      await db.query(
        `select deleted_at is null from public.posts where id='${f.post}';`,
      ),
      't',
    );
    console.info(
      'PASS: a stale parallel delete cannot override a restored target',
    );
  }
  {
    const f = await fixtures(db);
    const id = await reportId(db, f);
    const rev = await revision(db, f.post);
    const result = await race(
      db,
      'report-before-resolution',
      report(f, f.other),
      resolve(f, id, rev),
    );
    expectedError(result, 'MODERATION_REVISION_CONFLICT');
    await assertTarget(db, f, 2, true);
    console.info(
      'PASS: resolution checks target revision after a newly committed distinct report',
    );
  }
  {
    const f = await fixtures(db);
    const id = await reportId(db, f);
    const result = await race(
      db,
      'resolution-before-report',
      resolve(f, id, await revision(db, f.post)),
      report(f, f.other),
    );
    value(result);
    await assertTarget(db, f, 2, false);
    assert.equal(
      await db.query(
        `select count(*) from public.reports where target_id='${f.post}' and status='open';`,
      ),
      '1',
    );
    assert.equal(
      await db.query(
        `select count(*) from private.moderation_notices where report_id='${id}' and decision='restored';`,
      ),
      '1',
    );
    console.info(
      'PASS: a new post-restore reporter starts a fresh unresolved cycle without recounting old reports',
    );
  }
  {
    const f = await fixtures(db);
    const id = await reportId(db, f);
    const result = await race(
      db,
      'delete-before-report',
      resolve(f, id, await revision(db, f.post), 'delete'),
      report(f, f.other),
    );
    expectedError(result, 'COMMUNITY_TARGET_UNAVAILABLE');
    assert.equal(
      await db.query(
        `select count(*) from public.reports where target_id='${f.post}';`,
      ),
      '1',
    );
    console.info('PASS: a waiting new report cannot adopt deleted content');
  }
  {
    const f = await fixtures(db);
    const sql = report(f, f.artistUser, uuid(), f.reply, 'reply');
    const result = await race(db, 'duplicate-reply-report', sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    assert.equal(
      await db.query(
        `select report_count from public.replies where id='${f.reply}';`,
      ),
      '1',
    );
    console.info(
      'PASS: assigned artist reply reports preserve lifetime distinctness under replay',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'membership-before-reply-report',
      `delete from public.artist_members where artist_id='${f.artist}' and user_id='${f.artistUser}';`,
      report(f, f.artistUser, uuid(), f.reply, 'reply'),
    );
    expectedError(result, 'COMMUNITY_TARGET_UNAVAILABLE');
    assert.equal(
      await db.query(
        `select report_count from public.replies where id='${f.reply}';`,
      ),
      '0',
    );
    console.info(
      'PASS: membership revocation invalidates a waiting private reply report',
    );
  }
  {
    const f = await fixtures(db);
    const stamp = await profileStamp(db, f.reporter);
    const result = await race(
      db,
      'restriction-before-report',
      restrict(f, stamp),
      report(f),
    );
    expectedError(result, 'COMMUNITY_FORBIDDEN');
    await assertTarget(db, f, 0, false);
    console.info(
      'PASS: current restriction is enforced after the real reporter profile lock wait',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'expired-restriction-after-wait',
      `update public.profiles set is_restricted=true,restricted_until=clock_timestamp()+interval '1 second' where id='${f.reporter}';`,
      report(f),
      async () => {
        await db.query('select pg_sleep(1.1);');
      },
    );
    value(result);
    await assertTarget(db, f, 1, false);
    console.info(
      'PASS: restriction expiry uses wall clock after waiting rather than transaction start',
    );
  }
  {
    const f = await fixtures(db);
    const stamp = await profileStamp(db, f.reporter);
    const until = await db.query("select clock_timestamp()+interval '1 hour';");
    const sql = restrict(f, stamp, uuid(), `'${until}'`);
    const result = await race(db, 'duplicate-restriction', sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    assert.equal(
      await db.query(
        `select count(*) from public.community_moderation_log where target_id='${f.reporter}' and action='restrict';`,
      ),
      '1',
    );
    console.info(
      'PASS: exact restriction retry retains one audit and the original expiration',
    );
  }
  {
    const f = await fixtures(db);
    const stamp = await profileStamp(db, f.reporter);
    const result = await race(
      db,
      'stale-restriction',
      restrict(f, stamp),
      restrict(f, stamp),
    );
    expectedError(result, 'MODERATION_REVISION_CONFLICT');
    console.info(
      'PASS: a new restriction intent cannot silently overwrite a newer profile revision',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'role-revoked-before-queue',
      `update public.profiles set role='fan' where id='${f.admin}';`,
      authenticated(f.admin, 'select public.community_moderation_queue();'),
    );
    expectedError(result, 'COMMUNITY_FORBIDDEN');
    console.info(
      'PASS: admin queue rechecks current role after profile authority wait',
    );
  }
  {
    const f = await fixtures(db);
    const id = await reportId(db, f);
    await committed(db, resolve(f, id, await revision(db, f.post)));
    const result = await race(
      db,
      'restriction-before-notices',
      restrict(f, await profileStamp(db, f.reporter)),
      notices(f),
    );
    expectedError(result, 'COMMUNITY_FORBIDDEN');
    assert.equal(
      await db.query(
        `select count(*) from private.moderation_notices where report_id='${id}';`,
      ),
      '1',
    );
    console.info(
      'PASS: recipient notices retain evidence but deny reads after a restriction becomes current',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'policy-removed-before-report',
      'delete from private.community_policy;',
      report(f),
    );
    expectedError(result, 'COMMUNITY_POLICY_REQUIRED');
    await assertTarget(db, f, 0, false);
    console.info(
      'PASS: report creation fails closed after waiting for removed policy',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'hide-before-context',
      authenticated(
        f.admin,
        `select public.community_moderate('post','${f.post}','hide','Fictional visibility decision');`,
      ),
      authenticated(
        f.reporter,
        `select public.community_moderation_context('post','${f.post}');`,
      ),
    );
    expectedError(result, 'COMMUNITY_TARGET_UNAVAILABLE');
    console.info(
      'PASS: reporting context cannot expose a target hidden during its lock wait',
    );
  }
}

try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(
      `select (select count(*) from auth.users)+(select count(*) from public.posts)+(select count(*) from private.community_policy)+(select count(*) from storage.objects);`,
    ),
    '0',
    'Use freshly reset disposable local database; this script restores it afterward.',
  );
  shouldReset = true;
  const startedAt = performance.now();
  await run(db);
  assert.equal(
    completedCases,
    expectedCases,
    'Every declared moderation race executed.',
  );
  console.info(
    `All ${completedCases} community moderation PostgreSQL independent-session races passed in ${Math.round(performance.now() - startedAt)}ms.`,
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
        'Fixture cleanup failed; reset the disposable local database before further use.',
        error,
      );
      process.exitCode = 1;
    }
  }
}
