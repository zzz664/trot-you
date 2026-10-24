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
    this.label = `compose-concurrency-${label}`;
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
    const marker = `COMPOSE_TEST_DONE_${++commandSequence}`;
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
const service = (sql) => `set local role service_role; ${sql}`;
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

// Fictional identities and SQL Storage metadata only. Existing media RPCs are
// exercised normally; this does not parse, upload or probe media payload bytes.
async function fixture(db) {
  const authorId = uuid();
  const teammateId = uuid();
  const artistId = uuid();
  const otherArtistId = uuid();
  const slug = `compose-race-${artistId}`;
  const otherSlug = `compose-race-${otherArtistId}`;
  await db.query(`
    insert into auth.users(id,email,raw_user_meta_data) values
      ('${authorId}','compose-race@example.invalid','{}'),('${teammateId}','compose-teammate@example.invalid','{}');
    update public.profiles set role='artist' where id in('${authorId}','${teammateId}');
    insert into public.artists(id,slug,name,grade,status) values
      ('${artistId}','${slug}','허구 작성 경합 가수','B','active'),
      ('${otherArtistId}','${otherSlug}','허구 다른 경합 가수','B','active');
    insert into public.artist_members(artist_id,user_id) values
      ('${artistId}','${authorId}'),('${artistId}','${teammateId}'),('${otherArtistId}','${authorId}');
    insert into private.profile_onboarding_policy values(true,'${uuid()}',now(),2,10,array['금지단어'],null,null,null);
    insert into private.message_policy values(true,'fictional-compose-race',604800,300,1000,100,2,180,60,5,1000,2000,3000);
  `);
  return { authorId, teammateId, artistId, otherArtistId, slug, otherSlug };
}
const literal = (value) =>
  value === null ? 'null' : `'${value.replaceAll("'", "''")}'`;
function save(
  f,
  id,
  operation,
  revision,
  kind = 'text',
  body = '허구 경합 초안',
  mediaIds = [],
) {
  return authenticated(
    f.authorId,
    `select public.artist_compose_save('${f.slug}','${id}','${operation}',${revision},
    '${kind}',${literal(body)},array[${mediaIds.map(literal).join(',')}]::uuid[]);`,
  );
}
function remove(f, id, mediaId, revision, operation = uuid()) {
  return authenticated(
    f.authorId,
    `select public.artist_compose_remove_media('${f.slug}','${id}','${mediaId}',${revision},'${operation}');`,
  );
}
function finalize(f, pending) {
  return service(
    `select public.media_finalize_upload('${f.authorId}','${pending.upload_id}','${pending.objectId}',10,10,null);`,
  );
}
async function draft(db, f, kind = 'text') {
  const id = uuid();
  await db.query(
    `begin; ${save(f, id, uuid(), 0, kind, kind === 'text' ? '허구 경합 초안' : null)} commit;`,
  );
  return id;
}
async function pendingUpload(db, f, id) {
  const pending = JSON.parse(
    await db.query(
      `begin; ${service(`select public.media_begin_upload('${f.authorId}','${id}','image/png',100,'${uuid()}');`)} commit;`,
    ),
  );
  const objectId = uuid();
  await db.query(
    `insert into storage.objects(id,bucket_id,name,metadata) values('${objectId}','message-media','${pending.object_path}','{"mimetype":"image/png","size":100}');`,
  );
  return { ...pending, objectId };
}
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
  return result.following.value;
}
async function testConcurrency(db) {
  const f = await fixture(db);
  const id = uuid();
  const operation = uuid();
  const created = await race(
    db,
    'duplicate-create',
    save(f, id, operation, 0),
    save(f, id, operation, 0),
  );
  assert.deepEqual(
    JSON.parse(expectSuccess(created)),
    JSON.parse(created.winner),
  );
  assert.equal(
    await db.query(`select count(*) from public.messages where id='${id}';`),
    '1',
  );
  console.info(
    'PASS: simultaneous create retry returns one identical accepted draft',
  );

  const conflict = await race(
    db,
    'different-edits',
    save(f, id, uuid(), 1, 'text', 'winner'),
    save(f, id, uuid(), 1, 'text', 'stale'),
  );
  expectError(conflict, 'COMPOSE_REVISION_CONFLICT');
  assert.equal(
    await db.query(`select body from public.messages where id='${id}';`),
    'winner',
  );
  console.info(
    'PASS: competing revisions cannot silently overwrite a winning edit',
  );

  const keyConflict = await race(
    db,
    'changed-key',
    save(f, id, operation, 0),
    save(f, id, operation, 0, 'text', 'different'),
  );
  expectError(keyConflict, 'COMPOSE_OPERATION_CONFLICT');
  console.info('PASS: replay key cannot acquire a changed payload');

  const crossArtist = await race(
    db,
    'cross-artist-key',
    save(f, id, operation, 0),
    save({ ...f, slug: f.otherSlug }, uuid(), operation, 0),
  );
  expectError(crossArtist, 'COMPOSE_OPERATION_CONFLICT');
  console.info('PASS: operation identity cannot move to another artist');

  const restriction = await race(
    db,
    'restriction',
    `update public.profiles set is_restricted=true where id='${f.authorId}';`,
    save(f, id, operation, 0),
  );
  expectError(restriction, 'COMPOSE_FORBIDDEN');
  await db.query(
    `update public.profiles set is_restricted=false where id='${f.authorId}';`,
  );
  console.info(
    'PASS: accepted operation replay rechecks a winning restriction',
  );

  const role = await race(
    db,
    'role-loss',
    `update public.profiles set role='fan' where id='${f.authorId}';`,
    save(f, id, uuid(), 2),
  );
  expectError(role, 'COMPOSE_FORBIDDEN');
  await db.query(
    `update public.profiles set role='artist' where id='${f.authorId}';
    insert into public.artist_members(artist_id,user_id) values('${f.artistId}','${f.authorId}'),('${f.otherArtistId}','${f.authorId}');`,
  );
  console.info('PASS: role loss blocks a waiting owned draft mutation');

  const membership = await race(
    db,
    'membership-loss',
    `delete from public.artist_members where artist_id='${f.artistId}' and user_id='${f.authorId}';`,
    save(f, id, uuid(), 2),
  );
  expectError(membership, 'COMPOSE_FORBIDDEN');
  await db.query(
    `insert into public.artist_members(artist_id,user_id) values('${f.artistId}','${f.authorId}');`,
  );
  console.info(
    'PASS: membership removal blocks a waiting save after authoritative locks',
  );

  const pause = await race(
    db,
    'artist-pause',
    `update public.artists set status='paused' where id='${f.artistId}';`,
    save(f, id, uuid(), 2),
  );
  expectError(pause, 'COMPOSE_NOT_FOUND');
  await db.query(
    `update public.artists set status='active' where id='${f.artistId}';`,
  );
  console.info('PASS: paused artist cannot retain stale compose authority');

  const policy = await race(
    db,
    'policy-shrink',
    'update private.message_policy set max_text_length=1;',
    save(f, id, uuid(), 2),
  );
  expectError(policy, 'COMPOSE_TOO_LONG');
  await db.query('update private.message_policy set max_text_length=1000;');
  console.info('PASS: waiting save honors a changed current length policy');

  const pendingId = await draft(db, f, 'photo');
  const pendingRace = await race(
    db,
    'pending-before-type',
    service(
      `select public.media_begin_upload('${f.authorId}','${pendingId}','image/png',100,'${uuid()}');`,
    ),
    save(f, pendingId, uuid(), 1, 'text'),
  );
  expectError(pendingRace, 'COMPOSE_MEDIA_CONFLICT');
  const reservation = JSON.parse(pendingRace.winner);
  console.info(
    'PASS: upload reservation wins before a conflicting type switch',
  );

  const revoke = await race(
    db,
    'revoke-before-type',
    service(
      `select public.media_revoke_upload('${f.authorId}','${reservation.upload_id}');`,
    ),
    save(f, pendingId, uuid(), 1, 'text'),
  );
  assert.equal(JSON.parse(expectSuccess(revoke)).kind, 'text');
  console.info(
    'PASS: explicit pending upload revocation releases type transition',
  );

  const typeId = await draft(db, f, 'photo');
  const typeRace = await race(
    db,
    'type-before-upload',
    save(f, typeId, uuid(), 1, 'text'),
    service(
      `select public.media_begin_upload('${f.authorId}','${typeId}','image/png',100,'${uuid()}');`,
    ),
  );
  expectError(typeRace, 'MEDIA_DRAFT_REQUIRED');
  console.info(
    'PASS: completed type transition rejects a stale upload reservation',
  );

  const mediaId = await draft(db, f, 'photo');
  const pending = await pendingUpload(db, f, mediaId);
  const promotion = await race(
    db,
    'finalize-before-save',
    finalize(f, pending),
    save(f, mediaId, uuid(), 1, 'photo', 'stale'),
  );
  expectError(promotion, 'COMPOSE_REVISION_CONFLICT');
  console.info('PASS: finalized media invalidates the previous draft revision');

  const saveFirstId = await draft(db, f, 'photo');
  const secondPending = await pendingUpload(db, f, saveFirstId);
  const saveFirst = await race(
    db,
    'save-before-finalize',
    save(f, saveFirstId, uuid(), 1, 'photo', 'caption'),
    finalize(f, secondPending),
  );
  assert.equal(expectSuccess(saveFirst), secondPending.media_id);
  assert.equal(
    await db.query(
      `select revision from private.artist_compose_drafts where message_id='${saveFirstId}';`,
    ),
    '3',
  );
  console.info(
    'PASS: same-type caption save and later finalization preserve both changes',
  );

  const removeRace = await race(
    db,
    'remove-before-replay',
    remove(f, mediaId, pending.media_id, 2),
    finalize(f, pending),
  );
  expectError(removeRace, 'MEDIA_UPLOAD_REVOKED');
  assert.equal(
    await db.query(
      `select count(*) from storage.objects where id='${pending.objectId}';`,
    ),
    '1',
  );
  console.info(
    'PASS: removed completed upload cannot reattach; final bytes are not deleted',
  );

  const staleRemoveId = await draft(db, f, 'photo');
  const thirdPending = await pendingUpload(db, f, staleRemoveId);
  const staleRemove = await race(
    db,
    'finalize-before-remove',
    finalize(f, thirdPending),
    remove(f, staleRemoveId, thirdPending.media_id, 1),
  );
  expectError(staleRemove, 'COMPOSE_REVISION_CONFLICT');
  console.info('PASS: stale removal cannot race a newly finalized attachment');

  const ownerRevoked = await race(
    db,
    'membership-before-finalize',
    `delete from public.artist_members where artist_id='${f.artistId}' and user_id='${f.authorId}';`,
    finalize(f, secondPending),
  );
  expectError(ownerRevoked, 'MESSAGE_AUTHOR_FORBIDDEN');
  await db.query(
    `insert into public.artist_members(artist_id,user_id) values('${f.artistId}','${f.authorId}');`,
  );
  console.info(
    'PASS: completion replay honors revoked membership through existing media API',
  );

  const expiringId = await draft(db, f, 'photo');
  const expiring = await pendingUpload(db, f, expiringId);
  const expired = await race(
    db,
    'pending-expiry-during-lock',
    `select 1 from public.profiles where id='${f.authorId}' for update;
      update private.media_uploads set expires_at=clock_timestamp()+interval '200 milliseconds' where id='${expiring.upload_id}';`,
    authenticated(
      f.authorId,
      `select public.artist_compose_context('${f.slug}','${expiringId}');`,
    ),
    async () => {
      await db.query('select pg_sleep(0.3);');
    },
  );
  assert.deepEqual(
    JSON.parse(expectSuccess(expired)).selected_draft.pending_upload_ids,
    [],
  );
  console.info(
    'PASS: context excludes an upload that expires while waiting on actor lock',
  );

  const namePolicy = await race(
    db,
    'name-policy-withdrawal',
    'update private.profile_onboarding_policy set name_approved_at=null;',
    save(f, id, operation, 0),
  );
  expectError(namePolicy, 'COMPOSE_SETUP_NOT_READY');
  console.info(
    'PASS: current policy withdrawal blocks accepted-operation replay',
  );
  assert.equal(
    await db.query(
      "select count(*) from public.messages where status<>'draft';",
    ),
    '0',
  );
  assert.equal(
    await db.query('select count(*) from private.notification_jobs;'),
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
    (select count(*) from public.messages)+(select count(*) from public.message_media)+
    (select count(*) from private.media_uploads)+(select count(*) from private.artist_compose_drafts)+
    (select count(*) from private.artist_compose_operations)+(select count(*) from private.profile_onboarding_policy)+
    (select count(*) from private.message_policy)+
    (select count(*) from public.artists where id not in('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'));`),
    '0',
    'Use a freshly reset disposable local database with fictional seeds only; this test resets it afterward.',
  );
  shouldReset = true;
  await testConcurrency(db);
  console.info(
    'All nineteen PostgreSQL multi-session composer concurrency checks passed.',
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
