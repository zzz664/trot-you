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
    this.label = `media-concurrency-${label}`;
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
    const marker = `MEDIA_TEST_DONE_${++commandSequence}`;
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

async function fixture(db) {
  const f = {
    fan: uuid(),
    author: uuid(),
    admin: uuid(),
    artist: uuid(),
    subscription: uuid(),
    terms: uuid(),
    privacy: uuid(),
  };
  await db.query(`
    insert into auth.users(id,email,raw_user_meta_data) values
      ('${f.fan}','media-race-fan@example.invalid','{}'),
      ('${f.author}','media-race-author@example.invalid','{}'),
      ('${f.admin}','media-race-admin@example.invalid','{}');
    update public.profiles set role='artist' where id='${f.author}';
    update public.profiles set role='admin' where id='${f.admin}';
    insert into public.artists(id,slug,name,grade,status) values('${f.artist}','media-race-${f.artist}','허구 미디어 경합','B','active');
    insert into public.artist_members(artist_id,user_id) values('${f.artist}','${f.author}');
    insert into private.message_policy values(true,'fictional-media-race',604800,300,1000,100,1,180,60,5,1000,2000,3000);
    insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
      ('${f.terms}','terms','Fictional terms','Local race fixture only.',now(),now()),
      ('${f.privacy}','privacy','Fictional privacy','Local race fixture only.',now(),now());
    insert into private.profile_onboarding_policy values(true,'${uuid()}',now(),2,10,array['금지단어'],'${f.terms}','${f.privacy}',null);
    begin;
      ${authenticated(
        f.fan,
        `select public.onboarding_save_font('large');
        select public.onboarding_save_name('허구경합팬');
        select public.onboarding_complete_profile(true,true,'${f.terms}',true,'${f.privacy}');`,
      )}
    commit;
    update public.profiles set onboarding_completed_at=now() where id='${f.fan}';
    insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end)
      values('${f.subscription}','${f.fan}','${f.artist}','toss','active',now()-interval '1 day',now()-interval '1 day',now()-interval '1 day',now()+interval '30 days');
  `);
  return f;
}
const beginUpload = (f, message, request = uuid()) =>
  service(
    `select public.media_begin_upload('${f.author}','${message}','image/png',100,'${request}');`,
  );
const finalize = (f, upload, object) =>
  service(
    `select public.media_finalize_upload('${f.author}','${upload}','${object}',10,10,null);`,
  );
const read = (actor, media, preview = false) =>
  service(
    `select public.media_resolve_read('${actor}','${media}',${preview});`,
  );
async function draft(db, f) {
  return db.query(
    `begin; ${service(`select public.messaging_save_draft('${f.author}','${f.artist}',null,'photo',null);`)} commit;`,
  );
}
async function prepared(db, f) {
  const message = await draft(db, f);
  const u = JSON.parse(
    await db.query(`begin; ${beginUpload(f, message)} commit;`),
  );
  const object = uuid();
  // Metadata-only SQL fixtures deliberately do not claim actual blob verification.
  await db.query(
    `insert into storage.objects(id,bucket_id,name,metadata) values('${object}','message-media','${u.object_path}','{"mimetype":"image/png","size":100}');`,
  );
  return { message, u, object };
}
async function published(db, f) {
  const p = await prepared(db, f);
  await db.query(`begin; ${finalize(f, p.u.upload_id, p.object)} commit;`);
  await db.query(
    `begin; ${service(`select public.messaging_schedule('${f.author}','${p.message}',clock_timestamp());
    select public.messaging_dispatch('${p.message}');`)} commit;`,
  );
  return p;
}
function denied(result, code) {
  assert.ok(result.following.error, 'waiting operation must be rejected');
  assert.match(result.following.error.message, new RegExp(code));
  assert.doesNotMatch(
    result.following.error.message,
    /deadlock detected|statement timeout|lock timeout/,
  );
}
async function testConcurrency(db) {
  const f = await fixture(db);
  const quotaMessage = await draft(db, f);
  const quota = await race(
    db,
    'reserved-count',
    beginUpload(f, quotaMessage),
    beginUpload(f, quotaMessage),
  );
  denied(quota, 'MEDIA_COUNT_EXCEEDED');
  assert.equal(
    await db.query(
      `select count(*) from private.media_uploads where message_id='${quotaMessage}';`,
    ),
    '1',
  );
  console.info(
    'PASS: concurrent initialization cannot overreserve the last media slot',
  );

  const retryMessage = await draft(db, f);
  const request = uuid();
  const duplicate = await race(
    db,
    'request-replay',
    beginUpload(f, retryMessage, request),
    beginUpload(f, retryMessage, request),
  );
  assert.equal(duplicate.following.error, undefined);
  assert.equal(
    JSON.parse(duplicate.following.value).upload_id,
    JSON.parse(duplicate.winner).upload_id,
  );
  console.info(
    'PASS: simultaneous retry preserves one reservation and canonical generated paths',
  );

  const completing = await prepared(db, f);
  const complete = await race(
    db,
    'complete-replay',
    finalize(f, completing.u.upload_id, completing.object),
    finalize(f, completing.u.upload_id, completing.object),
  );
  assert.equal(complete.following.error, undefined);
  assert.equal(complete.following.value, completing.u.media_id);
  assert.equal(
    await db.query(
      `select count(*) from public.message_media where message_id='${completing.message}';`,
    ),
    '1',
  );
  console.info(
    'PASS: concurrent finalization registers exactly one immutable media reference',
  );

  const ready = await published(db, f);
  const revokedMember = await race(
    db,
    'membership-before-read',
    `delete from public.artist_members where artist_id='${f.artist}' and user_id='${f.author}';`,
    read(f.author, ready.u.media_id),
  );
  denied(revokedMember, 'MEDIA_FORBIDDEN');
  await db.query(
    `insert into public.artist_members(artist_id,user_id) values('${f.artist}','${f.author}');`,
  );
  console.info(
    'PASS: read waiting for membership deletion cannot mint an author capability',
  );

  const restricted = await race(
    db,
    'restriction-before-read',
    `update public.profiles set is_restricted=true where id='${f.fan}';`,
    read(f.fan, ready.u.media_id),
  );
  denied(restricted, 'MEDIA_FORBIDDEN');
  await db.query(
    `update public.profiles set is_restricted=false where id='${f.fan}';`,
  );
  console.info(
    'PASS: read waiting for actor restriction observes the committed restriction',
  );

  const expired = await race(
    db,
    'expiry-before-read',
    `update public.subscriptions set status='expired',current_period_end=now()-interval '1 second' where id='${f.subscription}';`,
    read(f.fan, ready.u.media_id),
  );
  denied(expired, 'MEDIA_FORBIDDEN');
  await db.query(
    `update public.subscriptions set status='active',current_period_end=now()+interval '30 days' where id='${f.subscription}';`,
  );
  console.info(
    'PASS: read waiting for subscription expiry cannot sign an expired entitlement',
  );

  await db.query(
    `begin; ${service(`select public.messaging_set_previews('${f.admin}','${f.artist}',array['${ready.message}']::uuid[]);`)} commit;`,
  );
  const previewRemoved = await race(
    db,
    'preview-removal-before-read',
    service(
      `select public.messaging_set_previews('${f.admin}','${f.artist}',array[]::uuid[]);`,
    ),
    read(f.fan, ready.u.media_id, true),
  );
  denied(previewRemoved, 'MEDIA_FORBIDDEN');
  console.info(
    'PASS: preview read waiting for selection removal does not retain stale permission',
  );

  const canceled = await race(
    db,
    'cancel-before-read',
    service(
      `select public.messaging_cancel('${f.author}','${ready.message}');`,
    ),
    read(f.fan, ready.u.media_id),
  );
  denied(canceled, 'MEDIA_FORBIDDEN');
  console.info(
    'PASS: read waiting for real message cancellation cannot sign canceled content',
  );

  const finishing = await prepared(db, f);
  const finalizationRevoked = await race(
    db,
    'membership-before-completion',
    `delete from public.artist_members where artist_id='${f.artist}' and user_id='${f.author}';`,
    finalize(f, finishing.u.upload_id, finishing.object),
  );
  denied(finalizationRevoked, 'MESSAGE_AUTHOR_FORBIDDEN');
  await db.query(
    `insert into public.artist_members(artist_id,user_id) values('${f.artist}','${f.author}');`,
  );
  console.info(
    'PASS: uploaded bytes do not bypass membership revocation at completion',
  );

  const expiration = await race(
    db,
    'deadline-during-wait',
    `select id from public.artists where id='${f.artist}' for update;`,
    finalize(f, finishing.u.upload_id, finishing.object),
    async () =>
      db.query(
        `update private.media_uploads set created_at=now()-interval '20 minutes',expires_at=now()-interval '10 minutes' where id='${finishing.u.upload_id}';`,
      ),
  );
  denied(expiration, 'MEDIA_UPLOAD_EXPIRED');
  assert.equal(
    await db.query(
      `select count(*) from public.message_media where message_id='${finishing.message}';`,
    ),
    '0',
  );
  console.info(
    'PASS: finalization rechecks wall-clock expiry after a confirmed lock wait',
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
    (select count(*) from private.media_uploads)+(select count(*) from private.message_policy)+
    (select count(*) from private.onboarding_documents)+(select count(*) from private.profile_onboarding_policy)+
    (select count(*) from storage.objects)+(select count(*) from public.artists where id not in (
      '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'));`),
    '0',
    'Use a freshly reset disposable local database; this script resets it afterward.',
  );
  shouldReset = true;
  await testConcurrency(db);
  console.info(
    'All ten PostgreSQL multi-session media concurrency checks passed.',
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
