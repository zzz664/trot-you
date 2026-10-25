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
    this.label = `community-posts-concurrency-${label}`;
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
    const marker = `COMMUNITY_POSTS_TEST_DONE_${++commandSequence}`;
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
const boardSlugs = new Map();
const service = (sql) => `set local role service_role; ${sql}`;
const create = (
  actor,
  artist,
  post = uuid(),
  operation = uuid(),
  title = 'Fictional board post',
  uploads = [],
  notice = false,
  pinned = false,
) => {
  const slug = `board-race-${artist}`;
  boardSlugs.set(post, slug);
  return authenticated(
    actor,
    `select public.board_ui_create('${slug}','${operation}','${post}','${artist}','${title}','Fictional body',array[${uploads.map((id) => `'${id}'`).join(',')}]::uuid[],${notice},${pinned});`,
  );
};
const remove = (actor, post, revision = 1, operation = uuid()) =>
  authenticated(
    actor,
    `select public.board_ui_delete('${boardSlugs.get(post)}','${operation}','${post}',${revision},true);`,
  );
const pin = (
  actor,
  post,
  revision = 1,
  operation = uuid(),
  notice = true,
  pinned = true,
) =>
  authenticated(
    actor,
    `select public.board_ui_notice('${boardSlugs.get(post)}','${operation}','${post}',${revision},${notice},${pinned});`,
  );
const list = (actor, slug) =>
  authenticated(actor, `select public.board_ui_list('${slug}');`);
const beginUpload = (
  actor,
  artist,
  post = uuid(),
  operation = uuid(),
  bytes = 100,
) =>
  service(
    `select public.board_media_begin_upload('${actor}','${artist}','${post}','image/png',${bytes},'${operation}');`,
  );
const finalize = (actor, upload, object, width = 100, height = 100) =>
  service(
    `select public.board_media_finalize_upload('${actor}','${upload}','${object}',${width},${height});`,
  );
const revoke = (actor, upload) =>
  service(`select public.board_media_revoke_upload('${actor}','${upload}');`);
async function fixtures(db) {
  const fan = uuid();
  const admin = uuid();
  const other = uuid();
  const artist = uuid();
  const slug = `board-race-${artist}`;
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values
    ('${fan}','${fan}@example.invalid','{}'),('${admin}','${admin}@example.invalid','{}'),('${other}','${other}@example.invalid','{}');
    update public.profiles set call_name='가상게시팬',onboarding_completed_at=clock_timestamp() where id in('${fan}','${admin}','${other}');
    update public.profiles set role='admin' where id='${admin}';
    insert into public.artists(id,slug,name,grade,status) values('${artist}','${slug}','Fictional board race artist','B','active');
    insert into private.community_policy(singleton,version,max_title_length,max_body_length,max_comment_length,max_reason_length,
      max_images,max_image_bytes,max_image_long_edge,auto_hide_report_count,rate_window_seconds,max_contributions_per_window,
      max_reports_per_window,forbidden_terms,forbidden_patterns)
    values(true,'fictional-board-race',100,1000,100,100,3,1048576,4096,3,60,1000,1000,'{}','{}')
    on conflict(singleton) do update set max_images=3,max_image_bytes=1048576,max_image_long_edge=4096;
  `);
  const post = JSON.parse(
    await db.query(`begin; ${create(fan, artist)} commit;`),
  );
  return { fan, admin, other, artist, slug, post };
}
async function current(db, post) {
  return JSON.parse(
    await db.query(
      `select to_jsonb(p) from public.posts p where id='${post}';`,
    ),
  );
}
async function uploadFixture(db, fixture, post = uuid()) {
  const upload = JSON.parse(
    await db.query(
      `begin; ${beginUpload(fixture.fan, fixture.artist, post)} commit;`,
    ),
  );
  const object = uuid();
  await db.query(
    `insert into storage.objects(id,bucket_id,name,metadata) values('${object}','board-media','${upload.object_path}','{"mimetype":"image/png","size":100}'::jsonb);`,
  );
  return { upload, object, post };
}
async function run(db) {
  {
    const f = await fixtures(db);
    const post = uuid();
    const operation = uuid();
    const sql = create(f.fan, f.artist, post, operation);
    const result = await race(db, 'duplicate-create', sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    assert.equal(
      await db.query(`select count(*) from public.posts where id='${post}';`),
      '1',
    );
    assert.equal(
      await db.query(
        `select count(*) from private.board_operations where actor_id='${f.fan}' and operation_id='${operation}';`,
      ),
      '1',
    );
    console.info(
      'PASS: exact concurrent creates publish one post and one immutable receipt',
    );
  }
  {
    const f = await fixtures(db);
    const post = uuid();
    const operation = uuid();
    const result = await race(
      db,
      'create-payload-conflict',
      create(f.fan, f.artist, post, operation),
      create(f.fan, f.artist, post, operation, 'Different title'),
    );
    expectedError(result, 'BOARD_OPERATION_CONFLICT');
    assert.equal((await current(db, post)).title, 'Fictional board post');
    console.info('PASS: in-flight create key cannot change its frozen payload');
  }
  {
    const f = await fixtures(db);
    const sql = remove(f.fan, f.post.id);
    const result = await race(db, 'duplicate-delete', sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    assert.ok((await current(db, f.post.id)).deleted_at);
    assert.equal(
      await db.query(
        `select count(*) from public.community_moderation_log where target_id='${f.post.id}' and action='delete';`,
      ),
      '1',
    );
    console.info('PASS: confirmed delete replay soft-deletes and audits once');
  }
  {
    const f = await fixtures(db);
    const sql = pin(f.admin, f.post.id);
    const result = await race(db, 'duplicate-pin', sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    assert.equal((await current(db, f.post.id)).revision, 2);
    assert.equal(
      await db.query(
        `select count(*) from public.community_moderation_log where target_id='${f.post.id}' and action='notice';`,
      ),
      '1',
    );
    console.info(
      'PASS: concurrent notice retry writes one revision and one audit',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'pin-before-delete',
      pin(f.admin, f.post.id),
      remove(f.fan, f.post.id),
    );
    expectedError(result, 'BOARD_REVISION_CONFLICT');
    assert.equal((await current(db, f.post.id)).is_pinned, true);
    assert.equal((await current(db, f.post.id)).deleted_at, null);
    console.info(
      'PASS: stale owner deletion cannot erase a newer notice revision',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'delete-before-pin',
      remove(f.fan, f.post.id),
      pin(f.admin, f.post.id),
    );
    expectedError(result, 'COMMUNITY_TARGET_UNAVAILABLE');
    assert.ok((await current(db, f.post.id)).deleted_at);
    console.info(
      'PASS: a pending notice operation cannot resurrect a deleted post',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'legacy-before-pin',
      authenticated(
        f.fan,
        `select public.community_update_post('${f.post.id}','Legacy new title','Legacy new body');`,
      ),
      pin(f.admin, f.post.id),
    );
    expectedError(result, 'BOARD_REVISION_CONFLICT');
    assert.equal((await current(db, f.post.id)).title, 'Legacy new title');
    console.info(
      'PASS: compatible legacy content edits invalidate stale notice forms',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'legacy-before-delete',
      authenticated(
        f.admin,
        `select public.community_set_notice('${f.post.id}',true,true);`,
      ),
      remove(f.fan, f.post.id),
    );
    expectedError(result, 'BOARD_REVISION_CONFLICT');
    console.info(
      'PASS: compatible legacy notice changes invalidate stale delete forms',
    );
  }
  for (const operation of ['list', 'create', 'upload', 'replay']) {
    const f = await fixtures(db);
    const accepted = create(f.fan, f.artist);
    if (operation === 'replay') await db.query(`begin; ${accepted} commit;`);
    const sql =
      operation === 'list'
        ? list(f.fan, f.slug)
        : operation === 'upload'
          ? beginUpload(f.fan, f.artist)
          : accepted;
    const result = await race(
      db,
      `restriction-before-${operation}`,
      `update public.profiles set is_restricted=true where id='${f.fan}';`,
      sql,
    );
    expectedError(result, 'COMMUNITY_FORBIDDEN');
    console.info(
      `PASS: ${operation} rechecks current restriction after its actor lock wait`,
    );
  }
  for (const operation of ['list', 'create']) {
    const f = await fixtures(db);
    const result = await race(
      db,
      `onboarding-before-${operation}`,
      `update public.profiles set onboarding_completed_at=null where id='${f.fan}';`,
      operation === 'list' ? list(f.fan, f.slug) : create(f.fan, f.artist),
    );
    expectedError(result, 'COMMUNITY_FORBIDDEN');
    console.info(
      `PASS: ${operation} rejects removed onboarding after its actor lock wait`,
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'role-before-pin',
      `update public.profiles set role='fan' where id='${f.admin}';`,
      pin(f.admin, f.post.id),
    );
    expectedError(result, 'COMMUNITY_FORBIDDEN');
    assert.equal((await current(db, f.post.id)).is_pinned, false);
    console.info(
      'PASS: notice capability is revoked before a blocked administrator write resumes',
    );
  }
  for (const operation of ['list', 'create', 'upload']) {
    const f = await fixtures(db);
    const sql =
      operation === 'list'
        ? list(f.fan, f.slug)
        : operation === 'create'
          ? create(f.fan, f.artist)
          : beginUpload(f.fan, f.artist);
    const result = await race(
      db,
      `pause-before-${operation}`,
      `update public.artists set status='paused' where id='${f.artist}';`,
      sql,
    );
    expectedError(result, 'COMMUNITY_BOARD_UNAVAILABLE');
    console.info(
      `PASS: ${operation} rejects the board after a waited artist pause`,
    );
  }
  {
    const f = await fixtures(db);
    const post = uuid();
    const operation = uuid();
    const sql = beginUpload(f.fan, f.artist, post, operation);
    const result = await race(db, 'duplicate-upload', sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    console.info(
      'PASS: concurrent upload reservation retry returns one quarantine identity',
    );
  }
  {
    const f = await fixtures(db);
    const post = uuid();
    const operation = uuid();
    const result = await race(
      db,
      'changed-upload',
      beginUpload(f.fan, f.artist, post, operation),
      beginUpload(f.fan, f.artist, post, operation, 101),
    );
    expectedError(result, 'BOARD_OPERATION_CONFLICT');
    console.info('PASS: concurrent upload retry cannot change declared bytes');
  }
  {
    const f = await fixtures(db);
    await db.query('update private.community_policy set max_images=1;');
    const result = await race(
      db,
      'upload-count',
      beginUpload(f.fan, f.artist),
      beginUpload(f.fan, f.artist),
    );
    expectedError(result, 'BOARD_IMAGE_LIMIT');
    console.info(
      'PASS: competing drafts cannot exceed the current per-actor staging count',
    );
  }
  for (const firstAction of ['finalize', 'revoke']) {
    const f = await fixtures(db);
    const u = await uploadFixture(db, f);
    const complete = finalize(f.fan, u.upload.upload_id, u.object);
    const cancel = revoke(f.fan, u.upload.upload_id);
    const result = await race(
      db,
      `${firstAction}-before-peer`,
      firstAction === 'finalize' ? complete : cancel,
      firstAction === 'finalize' ? cancel : complete,
    );
    if (firstAction === 'finalize') assert.equal(value(result), 't');
    else expectedError(result, 'BOARD_UPLOAD_REVOKED');
    assert.equal(
      await db.query(`select count(*) from public.posts where id='${u.post}';`),
      '0',
    );
    assert.equal(
      await db.query(
        `select count(*) from public.post_images where id='${u.upload.image_id}';`,
      ),
      '0',
    );
    console.info(
      `PASS: ${firstAction} and its competing upload operation cannot partially publish a post`,
    );
  }
  {
    const f = await fixtures(db);
    const u = await uploadFixture(db, f);
    const result = await race(
      db,
      'policy-before-finalize',
      'update private.community_policy set max_image_bytes=99;',
      finalize(f.fan, u.upload.upload_id, u.object),
    );
    expectedError(result, 'BOARD_IMAGE_INVALID');
    assert.equal(
      await db.query(
        `select count(*) from public.post_images where id='${u.upload.image_id}';`,
      ),
      '0',
    );
    console.info(
      'PASS: finalization rechecks a smaller image byte cap after waiting',
    );
  }
  {
    const f = await fixtures(db);
    const u = await uploadFixture(db, f);
    await db.query(
      `begin; ${finalize(f.fan, u.upload.upload_id, u.object)} commit;`,
    );
    await db.query(
      `begin; ${create(f.fan, f.artist, u.post, uuid(), 'Fictional image post', [u.upload.upload_id])} commit;`,
    );
    const result = await race(
      db,
      'delete-before-image-read',
      remove(f.fan, u.post),
      service(
        `select public.board_media_resolve_read('${f.other}','${u.upload.image_id}');`,
      ),
    );
    expectedError(result, 'COMMUNITY_TARGET_UNAVAILABLE');
    assert.equal(
      await db.query(
        `select count(*) from public.post_images where id='${u.upload.image_id}';`,
      ),
      '1',
    );
    console.info(
      'PASS: current soft deletion denies a blocked signed-image grant without destroying stored identity',
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
  await run(db);
  console.info(
    'All community posts PostgreSQL independent-session races passed.',
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
