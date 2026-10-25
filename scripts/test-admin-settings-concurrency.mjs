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
    this.label = `admin-settings-concurrency-${label}`;
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
    const marker = `ADMIN_SETTINGS_TEST_DONE_${++commandSequence}`;
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
const decision = 'ae700000-0000-4000-8000-000000000001';
const save = (actor, group, values, revision, operation = uuid()) =>
  authenticated(
    actor,
    `select public.admin_settings_save('${group}','${operation}',${revision},'${JSON.stringify(values)}'::jsonb,true,'${decision}');`,
  );
async function current(db, group) {
  return JSON.parse(
    await db.query(`select private.admin_settings_projection('${group}');`),
  );
}
async function actors(db) {
  const admin = uuid();
  const other = uuid();
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values('${admin}','${admin}@example.invalid','{}'),('${other}','${other}@example.invalid','{}');
    update public.profiles set role='admin' where id in('${admin}','${other}');`);
  return { admin, other };
}
async function run(db) {
  await db.query(`insert into private.message_policy values(true,'fictional-settings-race',604800,300,1000,100,10,180,60,5,10485760,20971520,104857600);
    insert into private.community_policy values(true,'fictional-settings-race',100,1000,100,100,3,10485760,1600,3,60,10,5,array['forbidden'],array['forbidden']);`);
  {
    const { admin, other } = await actors(db);
    const state = await current(db, 'display');
    const result = await race(
      db,
      'initial-display',
      save(admin, 'display', { page_size: 40 }, state.revision),
      save(other, 'display', { page_size: 50 }, state.revision),
    );
    expectedError(result, 'ADMIN_SETTINGS_REVISION_CONFLICT');
    assert.equal((await current(db, 'display')).values.page_size, 40);
    assert.equal(
      await db.query('select count(*) from private.admin_display_settings;'),
      '1',
    );
    console.info(
      'PASS: two administrators serialize the initial display setting and stale loser cannot overwrite',
    );
  }
  {
    const { admin } = await actors(db);
    const state = await current(db, 'display');
    const operation = uuid();
    const sql = save(
      admin,
      'display',
      { page_size: 41 },
      state.revision,
      operation,
    );
    const result = await race(db, 'duplicate-display', sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    assert.equal(
      await db.query(
        `select count(*) from private.admin_settings_audit where operation_id='${operation}';`,
      ),
      '1',
    );
    console.info(
      'PASS: same operation across sessions records one revision and one immutable audit',
    );
  }
  {
    const { admin } = await actors(db);
    const state = await current(db, 'display');
    const operation = uuid();
    const result = await race(
      db,
      'operation-reuse',
      save(admin, 'display', { page_size: 42 }, state.revision, operation),
      save(admin, 'display', { page_size: 43 }, state.revision, operation),
    );
    expectedError(result, 'ADMIN_SETTINGS_OPERATION_CONFLICT');
    console.info(
      'PASS: reused operation key with changed numeric payload is rejected after waiting',
    );
  }
  for (const kind of ['role', 'restriction']) {
    const { admin } = await actors(db);
    const state = await current(db, 'display');
    const mutation = kind === 'role' ? "role='fan'" : 'is_restricted=true';
    const result = await race(
      db,
      `loss-${kind}`,
      `update public.profiles set ${mutation} where id='${admin}';`,
      save(admin, 'display', { page_size: 44 }, state.revision),
    );
    expectedError(result, 'ADMIN_SETTINGS_FORBIDDEN');
    assert.equal((await current(db, 'display')).revision, state.revision);
    console.info(
      `PASS: concurrent ${kind} loss is rechecked before settings mutation`,
    );
  }
  {
    const { admin } = await actors(db);
    const result = await race(
      db,
      'read-role-loss',
      `update public.profiles set role='fan' where id='${admin}';`,
      authenticated(admin, 'select public.admin_settings_list();'),
    );
    expectedError(result, 'ADMIN_SETTINGS_FORBIDDEN');
    console.info(
      'PASS: administrative reads do not expose snapshots after a waited role revocation',
    );
  }
  {
    const { admin, other } = await actors(db);
    const state = await current(db, 'message');
    const result = await race(
      db,
      'message-cas',
      save(
        admin,
        'message',
        { ...state.values, max_text_length: 1100 },
        state.revision,
      ),
      save(
        other,
        'message',
        { ...state.values, max_text_length: 1200 },
        state.revision,
      ),
    );
    expectedError(result, 'ADMIN_SETTINGS_REVISION_CONFLICT');
    assert.equal((await current(db, 'message')).values.max_text_length, 1100);
    console.info(
      'PASS: existing message policy CAS prevents lost updates across administrators',
    );
  }
  {
    const { admin } = await actors(db);
    const state = await current(db, 'message');
    const result = await race(
      db,
      'operator-message',
      'update private.message_policy set max_text_length=1250;',
      save(
        admin,
        'message',
        { ...state.values, max_text_length: 1300 },
        state.revision,
      ),
    );
    expectedError(result, 'ADMIN_SETTINGS_REVISION_CONFLICT');
    assert.equal((await current(db, 'message')).values.max_text_length, 1250);
    console.info(
      'PASS: privileged operator policy changes invalidate an already loaded admin form',
    );
  }
  {
    const { admin } = await actors(db);
    const state = await current(db, 'community');
    const result = await race(
      db,
      'hidden-policy-change',
      "update private.community_policy set forbidden_terms=array['replacement-private-term'];",
      save(
        admin,
        'community',
        { ...state.values, max_body_length: 2000 },
        state.revision,
      ),
    );
    expectedError(result, 'ADMIN_SETTINGS_REVISION_CONFLICT');
    assert.equal(
      await db.query(
        "select count(*) from private.admin_settings_audit where before_value::text like '%replacement-private-term%' or after_value::text like '%replacement-private-term%';",
      ),
      '0',
    );
    console.info(
      'PASS: hidden moderation changes invalidate CAS without leaking the dataset into audit',
    );
  }
  {
    const { admin } = await actors(db);
    const state = await current(db, 'display');
    const result = await race(
      db,
      'operator-display',
      'update private.admin_display_settings set page_size=55;',
      save(admin, 'display', { page_size: 56 }, state.revision),
    );
    expectedError(result, 'ADMIN_SETTINGS_REVISION_CONFLICT');
    console.info(
      'PASS: direct operator display writes and admin CAS share a deadlock-free fence',
    );
  }
  {
    const { admin, other } = await actors(db);
    const artist = uuid();
    const messages = [uuid(), uuid()];
    await db.query(`insert into public.artists(id,slug,name,grade,status) values('${artist}','settings-race-${artist}','Fictional preview artist','B','active');
      insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at) values
      ${messages.map((id) => `('${id}','${artist}','${admin}','text','Fictional preview','sent',now()-interval '1 minute',now()-interval '1 minute')`).join(',')};`);
    const state = await current(db, 'message');
    const result = await race(
      db,
      'preview-before-cap',
      authenticated(
        admin,
        `select public.admin_artist_previews('${artist}','${uuid()}',1,array[${messages.map((id) => `'${id}'`).join(',')}]::uuid[]);`,
      ),
      save(
        other,
        'message',
        { ...state.values, preview_max_count: 1 },
        state.revision,
      ),
    );
    expectedError(result, 'ADMIN_SETTINGS_PREVIEW_LIMIT_CONFLICT');
    assert.equal((await current(db, 'message')).values.preview_max_count, 5);
    const revision = await db.query(
      `select revision from public.artists where id='${artist}';`,
    );
    await db.query(
      `begin; ${authenticated(admin, `select public.admin_artist_previews('${artist}','${uuid()}',${revision},'{}'::uuid[]);`)} commit;`,
    );
    const after = await current(db, 'message');
    const artistRevision = await db.query(
      `select revision from public.artists where id='${artist}';`,
    );
    const reverse = await race(
      db,
      'cap-before-preview',
      save(
        other,
        'message',
        { ...after.values, preview_max_count: 1 },
        after.revision,
      ),
      authenticated(
        admin,
        `select public.admin_artist_previews('${artist}','${uuid()}',${artistRevision},array[${messages.map((id) => `'${id}'`).join(',')}]::uuid[]);`,
      ),
    );
    expectedError(reverse, 'ADMIN_ARTIST_PREVIEWS_INVALID');
    assert.equal(
      await db.query(
        `select count(*) from public.messages where artist_id='${artist}' and is_preview;`,
      ),
      '0',
    );
    console.info(
      'PASS: selected-preview change and policy cap reduction serialize safely in both orders',
    );
  }
  {
    const { admin } = await actors(db);
    const state = await current(db, 'message');
    const result = await race(
      db,
      'policy-withdrawal',
      'delete from private.message_policy;',
      save(admin, 'message', state.values, state.revision),
    );
    expectedError(result, 'ADMIN_SETTINGS_REVISION_CONFLICT');
    assert.equal((await current(db, 'message')).configured, false);
    console.info(
      'PASS: concurrent policy withdrawal cannot be undone by a stale numeric editor',
    );
  }
}
try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(`select (select count(*) from auth.users)+(select count(*) from private.message_policy)+(select count(*) from private.community_policy)
    +(select count(*) from private.admin_display_settings)+(select count(*) from private.admin_settings_audit)+(select count(*) from private.admin_settings_operations)
    +(select count(*) from private.admin_settings_state where revision<>0)+(select count(*) from public.messages);`),
    '0',
    'Use freshly reset disposable local database; this script restores it afterward.',
  );
  shouldReset = true;
  await run(db);
  console.info(
    'All admin settings PostgreSQL independent-session races passed.',
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
        'Fixture cleanup failed; run npm run db:reset before using disposable database again.',
        error,
      );
      process.exitCode = 1;
    }
  }
}
