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
const expectedCases = 44;

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
    this.label = `community-interactions-concurrency-${label}`;
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
    const marker = `COMMUNITY_INTERACTIONS_TEST_DONE_${++commandSequence}`;
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

const read = (f, actor = f.fan) =>
  authenticated(
    actor,
    `select public.community_ui_interactions('${f.slug}','${f.post}');`,
  );
const create = (
  f,
  actor = f.fan,
  comment = uuid(),
  operation = uuid(),
  body = 'Fictional comment',
) =>
  authenticated(
    actor,
    `select public.community_ui_create_comment('${f.slug}','${operation}','${f.post}','${comment}','${body}');`,
  );
const edit = (
  f,
  comment,
  revision = 1,
  operation = uuid(),
  body = 'Fictional edited comment',
  actor = f.fan,
) =>
  authenticated(
    actor,
    `select public.community_ui_update_comment('${f.slug}','${operation}','${f.post}','${comment}',${revision},'${body}');`,
  );
const remove = (f, comment, revision = 1, operation = uuid()) =>
  authenticated(
    f.fan,
    `select public.community_ui_delete_comment('${f.slug}','${operation}','${f.post}','${comment}',${revision},true);`,
  );
const like = (f, liked = true, operation = uuid(), actor = f.fan) =>
  authenticated(
    actor,
    `select public.community_ui_set_like('${f.slug}','${operation}','${f.post}',${liked});`,
  );
const moderate = (f, target, id, decision) =>
  authenticated(
    f.admin,
    `select public.community_moderate('${target}','${id}','${decision}','Fictional concurrency decision');`,
  );
async function fixtures(db) {
  const fan = uuid();
  const admin = uuid();
  const other = uuid();
  const artist = uuid();
  const post = uuid();
  const slug = `interactions-race-${artist}`;
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values
    ('${fan}','${fan}@example.invalid','{}'),('${admin}','${admin}@example.invalid','{}'),('${other}','${other}@example.invalid','{}');
    update public.profiles set call_name='가상댓글팬',onboarding_completed_at=clock_timestamp() where id in('${fan}','${admin}','${other}');
    update public.profiles set role='admin' where id='${admin}';
    insert into public.artists(id,slug,name,grade,status) values('${artist}','${slug}','Fictional interaction race artist','B','active');
    insert into private.community_policy(singleton,version,max_title_length,max_body_length,max_comment_length,max_reason_length,
      max_images,max_image_bytes,max_image_long_edge,auto_hide_report_count,rate_window_seconds,max_contributions_per_window,
      max_reports_per_window,forbidden_terms,forbidden_patterns)
    values(true,'fictional-interactions-race',100,1000,100,100,3,1048576,4096,3,60,1000,1000,'{}','{}')
    on conflict(singleton) do update set max_comment_length=100,max_contributions_per_window=1000,forbidden_terms='{}',forbidden_patterns='{}';
    insert into private.point_policy(version,attendance_amount,post_amount,comment_amount,post_daily_cap,comment_daily_cap,deleted_content_treatment)
    values('fictional-interactions-race',10,20,5,null,null,'retain') on conflict(singleton) do nothing;`);
  await db.query(
    `begin; ${authenticated(fan, `select public.board_ui_create('${slug}',gen_random_uuid(),'${post}','${artist}','Fictional interaction post','Fictional body','{}'::uuid[],false,false);`)} commit;`,
  );
  return { fan, admin, other, artist, slug, post };
}
async function commentFixture(db, f) {
  const id = uuid();
  await db.query(`begin; ${create(f, f.fan, id)} commit;`);
  return id;
}
async function currentComment(db, id) {
  return JSON.parse(
    await db.query(
      `select to_jsonb(c) from public.comments c where id='${id}';`,
    ),
  );
}
async function assertCounters(db, f, comments, likes) {
  const actual = JSON.parse(
    await db.query(`select jsonb_build_object('comments',p.comment_count,'likes',p.like_count,
    'visible_comments',(select count(*) from public.comments c where c.post_id=p.id and not c.is_hidden and c.deleted_at is null),
    'actual_likes',(select count(*) from public.post_likes l where l.post_id=p.id)) from public.posts p where p.id='${f.post}';`),
  );
  assert.deepEqual(actual, {
    comments,
    likes,
    visible_comments: comments,
    actual_likes: likes,
  });
}
async function run(db) {
  {
    const f = await fixtures(db);
    const id = uuid();
    const operation = uuid();
    const sql = create(f, f.fan, id, operation);
    const result = await race(db, 'duplicate-create', sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    await assertCounters(db, f, 1, 0);
    assert.equal(
      await db.query(
        `select count(*) from private.board_operations where actor_id='${f.fan}' and operation_id='${operation}';`,
      ),
      '1',
    );
    assert.equal(
      await db.query(
        `select count(*) from private.point_ledger where comment_id='${id}';`,
      ),
      '1',
    );
    console.info(
      'PASS: duplicate comment creates write one comment, counter, receipt and existing-policy reward',
    );
  }
  {
    const f = await fixtures(db);
    const id = uuid();
    const operation = uuid();
    const result = await race(
      db,
      'changed-create',
      create(f, f.fan, id, operation),
      create(f, f.fan, id, operation, 'Changed payload'),
    );
    expectedError(result, 'BOARD_OPERATION_CONFLICT');
    assert.equal((await currentComment(db, id)).body, 'Fictional comment');
    await assertCounters(db, f, 1, 0);
    console.info(
      'PASS: in-flight comment request identity cannot replace its frozen content',
    );
  }
  {
    const f = await fixtures(db);
    const id = uuid();
    const result = await race(
      db,
      'duplicate-comment-identity',
      create(f, f.fan, id),
      create(f, f.fan, id),
    );
    expectedError(result, 'BOARD_OPERATION_CONFLICT');
    await assertCounters(db, f, 1, 0);
    console.info(
      'PASS: a different operation cannot adopt an already-created comment identity',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'two-comment-authors',
      create(f),
      create(f, f.other),
    );
    value(result);
    await assertCounters(db, f, 2, 0);
    console.info(
      'PASS: distinct authors serialize the shared parent and preserve both comment increments',
    );
  }
  {
    const f = await fixtures(db);
    const id = await commentFixture(db, f);
    const sql = edit(f, id);
    const result = await race(db, 'duplicate-edit', sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    assert.equal((await currentComment(db, id)).revision, 2);
    await assertCounters(db, f, 1, 0);
    console.info(
      'PASS: exact edit replay records one revision and leaves the visible counter unchanged',
    );
  }
  {
    const f = await fixtures(db);
    const id = await commentFixture(db, f);
    const result = await race(
      db,
      'stale-edit',
      edit(f, id),
      edit(f, id, 1, uuid(), 'Second edit'),
    );
    expectedError(result, 'BOARD_REVISION_CONFLICT');
    assert.equal(
      (await currentComment(db, id)).body,
      'Fictional edited comment',
    );
    await assertCounters(db, f, 1, 0);
    console.info(
      'PASS: stale parallel comment edit cannot overwrite a committed newer revision',
    );
  }
  {
    const f = await fixtures(db);
    const id = await commentFixture(db, f);
    const result = await race(
      db,
      'legacy-edit',
      authenticated(
        f.fan,
        `select public.community_update_comment('${id}','Legacy edit');`,
      ),
      edit(f, id),
    );
    expectedError(result, 'BOARD_REVISION_CONFLICT');
    assert.equal((await currentComment(db, id)).revision, 2);
    console.info(
      'PASS: legacy comment mutation invalidates the new editor revision',
    );
  }
  {
    const f = await fixtures(db);
    const id = await commentFixture(db, f);
    const sql = remove(f, id);
    const result = await race(db, 'duplicate-delete', sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    await assertCounters(db, f, 0, 0);
    assert.equal(
      await db.query(
        `select count(*) from public.community_moderation_log where target_id='${id}' and action='delete';`,
      ),
      '1',
    );
    assert.equal(
      await db.query(
        `select count(*) from private.point_ledger where comment_id='${id}';`,
      ),
      '1',
    );
    console.info(
      'PASS: confirmed comment delete retries decrement and audit once without altering retained rewards',
    );
  }
  {
    const f = await fixtures(db);
    const id = await commentFixture(db, f);
    const result = await race(
      db,
      'edit-before-delete',
      edit(f, id),
      remove(f, id),
    );
    expectedError(result, 'BOARD_REVISION_CONFLICT');
    await assertCounters(db, f, 1, 0);
    console.info(
      'PASS: a stale delete confirmation cannot erase an updated comment',
    );
  }
  for (const decision of ['hide', 'delete']) {
    const f = await fixtures(db);
    const id = await commentFixture(db, f);
    const result = await race(
      db,
      `${decision}-before-edit`,
      moderate(f, 'comment', id, decision),
      edit(f, id),
    );
    expectedError(result, 'COMMUNITY_TARGET_UNAVAILABLE');
    await assertCounters(db, f, 0, 0);
    console.info(
      `PASS: a pending edit cannot expose or resurrect a ${decision} comment`,
    );
  }
  {
    const f = await fixtures(db);
    const id = await commentFixture(db, f);
    const result = await race(
      db,
      'comment-hidden-before-read',
      moderate(f, 'comment', id, 'hide'),
      read(f),
    );
    const dto = JSON.parse(value(result));
    assert.equal(dto.comments.length, 0);
    assert.equal(dto.comment_count, 0);
    await assertCounters(db, f, 0, 0);
    console.info(
      'PASS: blocked interaction read observes comment hiding and its counter atomically',
    );
  }
  {
    const f = await fixtures(db);
    const sql = like(f);
    const result = await race(db, 'duplicate-like', sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    await assertCounters(db, f, 0, 1);
    console.info(
      'PASS: identical concurrent like operations insert exactly one membership and increment',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'two-likers',
      like(f),
      like(f, true, uuid(), f.other),
    );
    value(result);
    await assertCounters(db, f, 0, 2);
    console.info(
      'PASS: likes by separate actors retain both parent counter increments',
    );
  }
  {
    const f = await fixtures(db);
    const operation = uuid();
    const original = like(f, true, operation);
    const result = await race(
      db,
      'like-before-unlike',
      original,
      like(f, false),
    );
    value(result);
    await assertCounters(db, f, 0, 0);
    assert.equal(
      JSON.parse(await db.query(`begin; ${original} commit;`)).liked,
      true,
    );
    await assertCounters(db, f, 0, 0);
    console.info(
      'PASS: old successful like receipt cannot replay a mutation over a newer unlike',
    );
  }
  {
    const f = await fixtures(db);
    const operation = uuid();
    const result = await race(
      db,
      'like-payload-conflict',
      like(f, true, operation),
      like(f, false, operation),
    );
    expectedError(result, 'BOARD_OPERATION_CONFLICT');
    await assertCounters(db, f, 0, 1);
    console.info(
      'PASS: like receipt identity cannot be reused for the opposite desired state',
    );
  }
  {
    const f = await fixtures(db);
    const operation = uuid();
    const result = await race(
      db,
      'cross-action-receipt',
      create(f, f.fan, uuid(), operation),
      like(f, true, operation),
    );
    expectedError(result, 'BOARD_OPERATION_CONFLICT');
    await assertCounters(db, f, 1, 0);
    console.info(
      'PASS: actor-bound operation identities cannot cross comment and like action kinds',
    );
  }
  for (const decision of ['hide', 'delete']) {
    for (const action of [
      'read',
      'create',
      'edit',
      'delete',
      'like',
      'replay',
    ]) {
      const f = await fixtures(db);
      const id = await commentFixture(db, f);
      const accepted = like(f);
      if (action === 'replay') await db.query(`begin; ${accepted} commit;`);
      const operations = {
        read: read(f),
        create: create(f),
        edit: edit(f, id),
        delete: remove(f, id),
        like: like(f),
        replay: accepted,
      };
      const result = await race(
        db,
        `parent-${decision}-${action}`,
        moderate(f, 'post', f.post, decision),
        operations[action],
      );
      expectedError(result, 'COMMUNITY_TARGET_UNAVAILABLE');
      await assertCounters(db, f, 1, action === 'replay' ? 1 : 0);
      console.info(
        `PASS: ${action} rechecks ${decision} parent visibility after waiting without touching retained interactions`,
      );
    }
  }
  for (const change of ['restricted', 'onboarding', 'artist']) {
    for (const action of ['read', 'create', 'like', 'replay']) {
      const f = await fixtures(db);
      const accepted = like(f);
      if (action === 'replay') await db.query(`begin; ${accepted} commit;`);
      const changes = {
        restricted: `update public.profiles set is_restricted=true where id='${f.fan}';`,
        onboarding: `update public.profiles set onboarding_completed_at=null where id='${f.fan}';`,
        artist: `update public.artists set status='paused' where id='${f.artist}';`,
      };
      const operations = {
        read: read(f),
        create: create(f),
        like: like(f),
        replay: accepted,
      };
      const result = await race(
        db,
        `${change}-${action}`,
        changes[change],
        operations[action],
      );
      expectedError(
        result,
        change === 'artist'
          ? 'COMMUNITY_BOARD_UNAVAILABLE'
          : 'COMMUNITY_FORBIDDEN',
      );
      await assertCounters(db, f, 0, action === 'replay' ? 1 : 0);
      console.info(
        `PASS: ${action} rechecks current ${change} eligibility after its actual lock wait`,
      );
    }
  }
  for (const action of ['create', 'edit']) {
    const f = await fixtures(db);
    const id = await commentFixture(db, f);
    const result = await race(
      db,
      `policy-${action}`,
      'update private.community_policy set max_comment_length=3;',
      action === 'create' ? create(f) : edit(f, id),
    );
    expectedError(result, 'COMMUNITY_CONTENT_INVALID');
    await assertCounters(db, f, 1, 0);
    console.info(
      `PASS: ${action} enforces the newly committed configured comment length after waiting`,
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'policy-removal-before-read',
      'delete from private.community_policy;',
      read(f),
    );
    expectedError(result, 'COMMUNITY_POLICY_REQUIRED');
    await assertCounters(db, f, 0, 0);
    console.info(
      'PASS: interaction read fails closed after its configured policy is removed',
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
    'Every declared interaction race executed.',
  );
  console.info(
    `All ${completedCases} community interactions PostgreSQL independent-session races passed in ${Math.round(performance.now() - startedAt)}ms.`,
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
