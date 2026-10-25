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
    this.label = `content-calendar-concurrency-${label}`;
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
    const marker = `CONTENT_CALENDAR_TEST_DONE_${++commandSequence}`;
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
function input(artist, patch = {}) {
  return {
    artist_id: artist,
    date: '2028-02-10',
    topic: 'Fictional editorial topic',
    example_text: null,
    ...patch,
  };
}
const save = (
  actor,
  artist,
  id = null,
  revision = null,
  operation = uuid(),
  patch = {},
) =>
  authenticated(
    actor,
    `select public.content_calendar_admin_save('${operation}',${id ? `'${id}'` : 'null'},${revision ?? 'null'},'${JSON.stringify(input(artist, patch))}'::jsonb);`,
  );
const remove = (actor, id, revision, operation = uuid()) =>
  authenticated(
    actor,
    `select public.content_calendar_admin_delete('${operation}','${id}',${revision},true);`,
  );
const artistRead = (actor, slug) =>
  authenticated(
    actor,
    `select public.content_calendar_artist_context('${slug}','2028-02-01');`,
  );
const adminRead = (actor, artist) =>
  authenticated(
    actor,
    `select public.content_calendar_admin_list('${artist}','2028-02-01');`,
  );
async function fixtures(db) {
  const admin = uuid();
  const other = uuid();
  const member = uuid();
  const artist = uuid();
  const slug = `content-race-${artist}`;
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values('${admin}','${admin}@example.invalid','{}'),('${other}','${other}@example.invalid','{}'),('${member}','${member}@example.invalid','{}');
    update public.profiles set role='admin',call_name='가상계획팬',onboarding_completed_at=clock_timestamp() where id in('${admin}','${other}');
    update public.profiles set role='artist',call_name='가상계획팬',onboarding_completed_at=clock_timestamp() where id='${member}';
    insert into public.artists(id,slug,name,grade,status) values('${artist}','${slug}','Fictional editorial race artist','B','active');
    insert into public.artist_members(artist_id,user_id) values('${artist}','${member}');`);
  const entry = JSON.parse(
    await db.query(`begin; ${save(admin, artist)} commit;`),
  );
  return { admin, other, member, artist, slug, entry };
}
async function current(db, id) {
  const raw = await db.query(
    `select private.content_calendar_projection('${id}');`,
  );
  return raw ? JSON.parse(raw) : null;
}
async function auditCount(db, id) {
  return Number(
    await db.query(
      `select count(*) from public.calendar_audit_log where target_type='content_calendar' and target_id='${id}';`,
    ),
  );
}
async function run(db) {
  {
    const { admin, artist } = await fixtures(db);
    const operation = uuid();
    const sql = save(admin, artist, null, null, operation, {
      date: '2028-02-11',
    });
    const result = await race(db, 'duplicate-create', sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    const entry = JSON.parse(result.winner);
    assert.equal(await auditCount(db, entry.id), 1);
    assert.equal(
      await db.query(
        `select count(*) from private.content_calendar_operations where actor_id='${admin}' and operation_id='${operation}';`,
      ),
      '1',
    );
    console.info(
      'PASS: concurrent exact create retries return one entry, one audit and one immutable receipt',
    );
  }
  {
    const { admin, other, artist } = await fixtures(db);
    const result = await race(
      db,
      'occupied-date',
      save(admin, artist, null, null, uuid(), { date: '2028-02-11' }),
      save(other, artist, null, null, uuid(), {
        date: '2028-02-11',
        topic: 'Losing topic',
      }),
    );
    expectedError(result, 'CONTENT_CALENDAR_DATE_CONFLICT');
    assert.equal(
      await db.query(
        `select count(*) from public.content_calendar where artist_id='${artist}' and date='2028-02-11';`,
      ),
      '1',
    );
    console.info(
      'PASS: two administrators cannot silently overwrite the same previously absent date',
    );
  }
  {
    const { admin, artist } = await fixtures(db);
    const operation = uuid();
    const result = await race(
      db,
      'operation-reuse',
      save(admin, artist, null, null, operation, { date: '2028-02-11' }),
      save(admin, artist, null, null, operation, { date: '2028-02-12' }),
    );
    expectedError(result, 'CONTENT_CALENDAR_OPERATION_CONFLICT');
    console.info(
      'PASS: reused in-flight operation key cannot alter its date or payload',
    );
  }
  {
    const { admin, other, artist, entry } = await fixtures(db);
    const result = await race(
      db,
      'edit-cas',
      save(admin, artist, entry.id, 1, uuid(), { topic: 'Winner' }),
      save(other, artist, entry.id, 1, uuid(), { topic: 'Stale loser' }),
    );
    expectedError(result, 'CONTENT_CALENDAR_REVISION_CONFLICT');
    assert.equal((await current(db, entry.id)).topic, 'Winner');
    assert.equal(await auditCount(db, entry.id), 2);
    console.info(
      'PASS: competing editor cannot overwrite the newer committed topic',
    );
  }
  {
    const { admin, artist, entry } = await fixtures(db);
    const sql = save(admin, artist, entry.id, 1, uuid(), {
      topic: 'Exactly once',
    });
    const result = await race(db, 'duplicate-update', sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    assert.equal((await current(db, entry.id)).revision, 2);
    assert.equal(await auditCount(db, entry.id), 2);
    console.info(
      'PASS: concurrent exact update retries apply one revision and one change audit',
    );
  }
  {
    const { admin, other, artist, entry } = await fixtures(db);
    const result = await race(
      db,
      'concurrent-noop',
      save(admin, artist, entry.id, 1),
      save(other, artist, entry.id, 1),
    );
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    assert.equal((await current(db, entry.id)).revision, 1);
    assert.equal(await auditCount(db, entry.id), 1);
    console.info(
      'PASS: two unchanged saves preserve revision, original timestamps and audit history',
    );
  }
  {
    const { admin, other, artist, entry } = await fixtures(db);
    const result = await race(
      db,
      'delete-before-edit',
      remove(admin, entry.id, 1),
      save(other, artist, entry.id, 1),
    );
    expectedError(result, 'CONTENT_CALENDAR_ENTRY_UNAVAILABLE');
    assert.equal(await current(db, entry.id), null);
    console.info('PASS: blocked stale edit cannot recreate a removed topic');
  }
  {
    const { admin, other, artist, entry } = await fixtures(db);
    const result = await race(
      db,
      'edit-before-delete',
      save(admin, artist, entry.id, 1, uuid(), { topic: 'Keep newer topic' }),
      remove(other, entry.id, 1),
    );
    expectedError(result, 'CONTENT_CALENDAR_REVISION_CONFLICT');
    assert.equal((await current(db, entry.id)).topic, 'Keep newer topic');
    console.info(
      'PASS: blocked stale delete cannot erase a newer editorial revision',
    );
  }
  {
    const { admin, entry } = await fixtures(db);
    const sql = remove(admin, entry.id, 1);
    const result = await race(db, 'duplicate-delete', sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    assert.equal(await auditCount(db, entry.id), 2);
    console.info(
      'PASS: concurrent confirmed deletion retries remove and audit exactly once',
    );
  }
  {
    const { admin, other, artist, entry } = await fixtures(db);
    const result = await race(
      db,
      'new-create-after-delete',
      remove(admin, entry.id, 1),
      save(other, artist),
    );
    const replacement = JSON.parse(value(result));
    assert.notEqual(replacement.id, entry.id);
    assert.equal(replacement.revision, 1);
    assert.equal(await current(db, entry.id), null);
    console.info(
      'PASS: intentional fresh create after deletion receives a new identity, never resurrects old entry',
    );
  }
  for (const kind of ['role', 'restriction']) {
    const { admin, artist, entry } = await fixtures(db);
    const mutation = kind === 'role' ? "role='fan'" : 'is_restricted=true';
    const result = await race(
      db,
      `write-${kind}-loss`,
      `update public.profiles set ${mutation} where id='${admin}';`,
      save(admin, artist, entry.id, 1, uuid(), { topic: 'Must not be saved' }),
    );
    expectedError(result, 'CALENDAR_FORBIDDEN');
    assert.equal((await current(db, entry.id)).revision, 1);
    console.info(
      `PASS: administrator ${kind} revocation is rechecked after a waited profile lock`,
    );
  }
  for (const kind of ['role', 'restriction']) {
    const { admin, artist } = await fixtures(db);
    const mutation = kind === 'role' ? "role='fan'" : 'is_restricted=true';
    const result = await race(
      db,
      `admin-read-${kind}-loss`,
      `update public.profiles set ${mutation} where id='${admin}';`,
      adminRead(admin, artist),
    );
    expectedError(result, 'CALENDAR_FORBIDDEN');
    console.info(
      `PASS: administrative month read rejects current ${kind} loss after blocking`,
    );
  }
  for (const kind of ['role', 'restriction', 'onboarding']) {
    const { member, slug } = await fixtures(db);
    const mutation =
      kind === 'role'
        ? "role='fan'"
        : kind === 'restriction'
          ? 'is_restricted=true'
          : 'onboarding_completed_at=null';
    const result = await race(
      db,
      `artist-read-${kind}-loss`,
      `update public.profiles set ${mutation} where id='${member}';`,
      artistRead(member, slug),
    );
    expectedError(result, 'ARTIST_REPLY_FORBIDDEN');
    console.info(
      `PASS: artist calendar read rejects current ${kind} loss after blocking`,
    );
  }
  {
    const { member, artist, slug } = await fixtures(db);
    const result = await race(
      db,
      'membership-loss',
      `delete from public.artist_members where artist_id='${artist}' and user_id='${member}';`,
      artistRead(member, slug),
    );
    expectedError(result, 'ARTIST_REPLY_FORBIDDEN');
    console.info(
      'PASS: removed membership cannot return editorial topics after a waited member lock',
    );
  }
  {
    const { member, artist, slug } = await fixtures(db);
    const result = await race(
      db,
      'artist-paused',
      `update public.artists set status='paused' where id='${artist}';`,
      artistRead(member, slug),
    );
    expectedError(result, 'ARTIST_REPLY_NOT_FOUND');
    console.info(
      'PASS: paused artist cannot expose private planning after a waited artist lock',
    );
  }
  {
    const { admin, member, slug, entry } = await fixtures(db);
    const result = await race(
      db,
      'read-before-delete',
      artistRead(member, slug),
      remove(admin, entry.id, 1),
    );
    assert.equal(JSON.parse(result.winner).entries[0].id, entry.id);
    assert.equal(JSON.parse(value(result)).deleted, true);
    assert.equal(await current(db, entry.id), null);
    console.info(
      'PASS: accepted artist read holds a consistent planning snapshot before a blocked deletion',
    );
  }
  {
    const { admin, member, artist, slug, entry } = await fixtures(db);
    const result = await race(
      db,
      'edit-before-read',
      save(admin, artist, entry.id, 1, uuid(), {
        topic: 'Read committed edit',
      }),
      artistRead(member, slug),
    );
    assert.equal(
      JSON.parse(value(result)).entries[0].topic,
      'Read committed edit',
    );
    assert.equal(JSON.parse(value(result)).entries[0].revision, 2);
    console.info(
      'PASS: artist month read observes newest committed entry after the write lock wait',
    );
  }
  {
    const { admin, artist, entry } = await fixtures(db);
    const result = await race(
      db,
      'operator-before-cas',
      `update public.content_calendar set topic='Operator edit' where id='${entry.id}';`,
      save(admin, artist, entry.id, 1),
    );
    expectedError(result, 'CONTENT_CALENDAR_REVISION_CONFLICT');
    assert.equal((await current(db, entry.id)).topic, 'Operator edit');
    console.info(
      'PASS: privileged direct edit also invalidates a previously loaded editor revision',
    );
  }
  {
    const { admin, other, artist, entry } = await fixtures(db);
    const result = await race(
      db,
      'legacy-before-cas',
      authenticated(
        admin,
        `select public.content_calendar_upsert('${artist}','2028-02-10','Legacy edit');`,
      ),
      save(other, artist, entry.id, 1),
    );
    expectedError(result, 'CONTENT_CALENDAR_REVISION_CONFLICT');
    assert.equal((await current(db, entry.id)).topic, 'Legacy edit');
    console.info(
      'PASS: legacy writer keeps compatibility and prevents a stale new-editor overwrite',
    );
  }
  {
    const { admin, artist, entry } = await fixtures(db);
    const operation = uuid();
    const sql = save(admin, artist, entry.id, 1, operation);
    await db.query(`begin; ${sql} commit;`);
    const result = await race(
      db,
      'receipt-replay-role-loss',
      `update public.profiles set role='fan' where id='${admin}';`,
      sql,
    );
    expectedError(result, 'CALENDAR_FORBIDDEN');
    console.info(
      'PASS: accepted idempotency receipt never bypasses current administrator authorization',
    );
  }
}
try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(
      `select (select count(*) from auth.users)+(select count(*) from public.content_calendar)+(select count(*) from private.content_calendar_operations);`,
    ),
    '0',
    'Use freshly reset disposable local database; this script restores it afterward.',
  );
  shouldReset = true;
  await run(db);
  console.info(
    'All content calendar PostgreSQL independent-session races passed.',
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
