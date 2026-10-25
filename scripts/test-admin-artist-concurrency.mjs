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
    this.label = `admin-artist-concurrency-${label}`;
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
    const marker = `ADMIN_ARTIST_TEST_DONE_${++commandSequence}`;
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
const payload = (f, status = 'active', name = 'Fictional admin artist') =>
  JSON.stringify({
    slug: f.slug,
    name,
    intro: null,
    grade: 'B',
    status,
    agency_name: null,
    contract_started_at: null,
    contract_ended_at: null,
    display_order: 0,
  });
const save = (
  f,
  actor = f.admin,
  revision = 1,
  operation = uuid(),
  status = 'active',
) =>
  authenticated(
    actor,
    `select public.admin_artist_save('${f.artist}','${operation}',${revision},'${payload(f, status)}'::jsonb);`,
  );
const invite = (f, actor = f.admin, revision = 1, operation = uuid()) =>
  authenticated(
    actor,
    `select public.admin_artist_invite('${f.artist}','${f.target}',false,'${operation}',${revision},true);`,
  );
const respond = (f, operation = uuid(), revision = 1) =>
  authenticated(
    f.target,
    `select public.artist_account_respond('${f.invitation}','${operation}',${revision},true,true);`,
  );
const cancelInvite = (f, operation = uuid(), revision = 1) =>
  authenticated(
    f.admin,
    `select public.admin_artist_cancel_invite('${f.invitation}','${operation}',${revision},true);`,
  );
async function fixture(db, label, withInvitation = false) {
  const f = {
    admin: uuid(),
    otherAdmin: uuid(),
    target: uuid(),
    artist: uuid(),
    slug: `admin-race-${label}-${uuid()}`,
  };
  await db.query(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
    ('${f.admin}','${f.admin}@example.invalid',now(),'{}'),('${f.otherAdmin}','${f.otherAdmin}@example.invalid',now(),'{}'),('${f.target}','${f.target}@example.invalid',now(),'{}');
    update public.profiles set role='admin' where id in('${f.admin}','${f.otherAdmin}');
    update public.profiles set call_name='허구 계정',onboarding_completed_at=clock_timestamp() where id='${f.target}';
    insert into public.artists(id,slug,name,grade,status) values('${f.artist}','${f.slug}','Fictional admin artist','B','active');
    update private.artist_account_link_policy set enabled=true;`);
  if (withInvitation) {
    const row = JSON.parse(await db.query(`begin; ${invite(f)} commit;`));
    f.invitation = row.id;
  }
  return f;
}
async function run(db) {
  await db.query(`insert into private.artist_account_link_policy values(true,true,now(),'fictional-local-concurrency-only',48);
    insert into private.message_policy values(true,'fictional-admin-race',604800,300,1000,100,10,180,60,5,10485760,20971520,104857600);`);
  {
    const f = await fixture(db, 'cas');
    const result = await race(db, 'cas', save(f), save(f, f.otherAdmin));
    expectedError(result, 'ADMIN_ARTIST_REVISION_CONFLICT');
    assert.equal(
      await db.query(
        `select revision from public.artists where id='${f.artist}';`,
      ),
      '2',
    );
    console.info(
      'PASS: independent admins serialize compare-and-set profile edits',
    );
  }
  {
    const f = await fixture(db, 'replay');
    const operation = uuid();
    const result = await race(
      db,
      'replay',
      save(f, f.admin, 1, operation),
      save(f, f.admin, 1, operation),
    );
    assert.equal(value(result), result.winner);
    assert.equal(
      await db.query(
        `select count(*) from private.admin_artist_audit where artist_id='${f.artist}';`,
      ),
      '1',
    );
    console.info(
      'PASS: repeated save operation commits one revision and audit',
    );
  }
  {
    const f = await fixture(db, 'slug');
    const first = { ...f, artist: uuid(), slug: `collision-${uuid()}` };
    const second = { ...first, artist: uuid() };
    const result = await race(
      db,
      'slug',
      save(first, f.admin, 0),
      save(second, f.otherAdmin, 0),
    );
    expectedError(result, 'ADMIN_ARTIST_SLUG_CONFLICT');
    assert.equal(
      await db.query(
        `select count(*) from public.artists where slug='${first.slug}';`,
      ),
      '1',
    );
    console.info(
      'PASS: simultaneous artist creates cannot duplicate a public slug',
    );
  }
  {
    const f = await fixture(db, 'role-loss');
    const result = await race(
      db,
      'role-loss',
      `update public.profiles set role='fan' where id='${f.admin}';`,
      save(f),
    );
    expectedError(result, 'ADMIN_ARTIST_FORBIDDEN');
    console.info(
      'PASS: admin revocation is reread after waiting, not cached from session',
    );
  }
  {
    const f = await fixture(db, 'deactivate');
    const result = await race(
      db,
      'deactivate',
      save(f, f.admin, 1, uuid(), 'paused'),
      invite(f, f.otherAdmin),
    );
    expectedError(result, 'ADMIN_ARTIST_ACCOUNT_UNAVAILABLE');
    console.info(
      'PASS: account issue waiting on deactivation cannot create fresh access intent',
    );
  }
  {
    const f = await fixture(db, 'two-invites');
    const result = await race(
      db,
      'two-invites',
      invite(f),
      invite(f, f.otherAdmin),
    );
    expectedError(result, 'ADMIN_ARTIST_REVISION_CONFLICT');
    assert.equal(
      await db.query(
        `select count(*) from private.artist_account_invitations where artist_id='${f.artist}';`,
      ),
      '1',
    );
    assert.equal(
      await db.query(
        `select count(*) from public.artist_members where artist_id='${f.artist}';`,
      ),
      '0',
    );
    console.info(
      'PASS: overlapping invite requests preserve one pending intent and no access',
    );
  }
  {
    const f = await fixture(db, 'cancel-first', true);
    const result = await race(db, 'cancel-first', cancelInvite(f), respond(f));
    expectedError(result, 'ADMIN_ARTIST_REVISION_CONFLICT');
    assert.equal(
      await db.query(
        `select count(*) from public.artist_members where artist_id='${f.artist}';`,
      ),
      '0',
    );
    console.info(
      'PASS: cancellation before recipient acceptance prevents membership',
    );
  }
  {
    const f = await fixture(db, 'accept-first', true);
    const result = await race(db, 'accept-first', respond(f), cancelInvite(f));
    expectedError(result, 'ADMIN_ARTIST_REVISION_CONFLICT');
    assert.equal(
      await db.query(
        `select count(*) from public.artist_members where artist_id='${f.artist}';`,
      ),
      '1',
    );
    console.info(
      'PASS: accepted invite cannot be mislabeled canceled by stale admin form',
    );
  }
  {
    const f = await fixture(db, 'inviter-revoked', true);
    const result = await race(
      db,
      'inviter-revoked',
      `update public.profiles set role='fan' where id='${f.admin}';`,
      respond(f),
    );
    expectedError(result, 'ADMIN_ARTIST_FORBIDDEN');
    console.info(
      'PASS: revoked issuing admin cannot leave an executable authority grant',
    );
  }
  {
    const f = await fixture(db, 'target-restricted', true);
    const result = await race(
      db,
      'target-restricted',
      `update public.profiles set is_restricted=true where id='${f.target}';`,
      respond(f),
    );
    expectedError(result, 'ADMIN_ARTIST_FORBIDDEN');
    console.info('PASS: recipient restriction wins before account acceptance');
  }
  {
    const f = await fixture(db, 'policy-withdrawn', true);
    const result = await race(
      db,
      'policy-withdrawn',
      `update private.artist_account_link_policy set enabled=false;`,
      respond(f),
    );
    expectedError(result, 'ADMIN_ARTIST_SETUP_NOT_READY');
    console.info(
      'PASS: withdrawn onboarding decision is reread at recipient confirmation',
    );
  }
  {
    const f = await fixture(db, 'expired', true);
    const result = await race(
      db,
      'expired',
      `update private.artist_account_invitations set created_at=now()-interval '3 days',expires_at=now()-interval '1 day' where id='${f.invitation}';`,
      respond(f),
    );
    expectedError(result, 'ADMIN_ARTIST_INVITATION_EXPIRED');
    console.info('PASS: invitation expiry is checked after row lock wait');
  }
  {
    const f = await fixture(db, 'double-accept', true);
    const operation = uuid();
    const result = await race(
      db,
      'double-accept',
      respond(f, operation),
      respond(f, operation),
    );
    assert.equal(value(result), result.winner);
    assert.equal(
      await db.query(
        `select count(*) from public.artist_members where artist_id='${f.artist}';`,
      ),
      '1',
    );
    assert.equal(
      await db.query(
        `select count(*) from private.admin_artist_audit where artist_id='${f.artist}' and action='accept_invite';`,
      ),
      '1',
    );
    console.info(
      'PASS: duplicate recipient confirmation commits one membership and audit',
    );
  }
  {
    const f = await fixture(db, 'unlink-replay', true);
    const operation = uuid();
    await db.query(`begin; ${respond(f, operation)} commit;`);
    const revision = await db.query(
      `select revision from public.artists where id='${f.artist}';`,
    );
    const result = await race(
      db,
      'unlink-replay',
      authenticated(
        f.admin,
        `select public.admin_artist_unlink('${f.artist}','${f.target}','${uuid()}',${revision},true);`,
      ),
      respond(f, operation),
    );
    assert.equal(JSON.parse(value(result)).state, 'accepted');
    assert.equal(
      await db.query(
        `select count(*) from public.artist_members where artist_id='${f.artist}';`,
      ),
      '0',
    );
    assert.equal(
      await db.query(
        `select role from public.profiles where id='${f.target}';`,
      ),
      'fan',
    );
    console.info(
      'PASS: accepted-response replay after unlink never regrants revoked access',
    );
  }
  {
    const f = await fixture(db, 'preview');
    const message = uuid();
    await db.query(
      `insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at) values('${message}','${f.artist}','${f.admin}','text','허구 맛보기','sent',now()-interval '1 minute',now()-interval '1 minute');`,
    );
    const preview = (actor, ids, revision = 1) =>
      authenticated(
        actor,
        `select public.admin_artist_previews('${f.artist}','${uuid()}',${revision},array[${ids.map((id) => `'${id}'`).join(',')}]::uuid[]);`,
      );
    const result = await race(
      db,
      'preview',
      preview(f.admin, [message]),
      preview(f.otherAdmin, []),
    );
    expectedError(result, 'ADMIN_ARTIST_REVISION_CONFLICT');
    assert.equal(
      await db.query(
        `select is_preview from public.messages where id='${message}';`,
      ),
      't',
    );
    const revision = await db.query(
      `select revision from public.artists where id='${f.artist}';`,
    );
    const canceled = await race(
      db,
      'preview-cancel',
      `set local role service_role; select public.messaging_cancel('${f.admin}','${message}');`,
      preview(f.otherAdmin, [message], revision),
    );
    expectedError(canceled, 'ADMIN_ARTIST_REVISION_CONFLICT');
    assert.equal(
      await db.query(
        `select status from public.messages where id='${message}';`,
      ),
      'canceled',
    );
    console.info(
      'PASS: preview replacement and message cancellation both invalidate stale selection',
    );
  }
}
try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(`select
    (select count(*) from auth.users)+(select count(*) from public.profiles)+
    (select count(*) from private.artist_account_link_policy)+(select count(*) from private.artist_account_invitations)+
    (select count(*) from private.admin_artist_operations)+(select count(*) from private.admin_artist_audit)+
    (select count(*) from private.admin_bootstrap_audit)+(select count(*) from public.messages)+
    (select count(*) from public.artists where id not in('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'));`),
    '0',
    'Use freshly reset disposable local database; this script restores it afterward.',
  );
  shouldReset = true;
  await run(db);
  console.info('All admin artist PostgreSQL independent-session races passed.');
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
        'Fixture cleanup failed; run npm run db:reset before using disposable database again.',
        error,
      );
      process.exitCode = 1;
    }
  }
}
