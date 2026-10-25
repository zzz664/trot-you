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
    this.label = `schedule-management-concurrency-${label}`;
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
    const marker = `SCHEDULE_MANAGEMENT_TEST_DONE_${++commandSequence}`;
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
    type: 'concert',
    status: 'published',
    title: 'Fictional concurrency event',
    description: null,
    starts_at: '2028-02-10T10:00:00+09:00',
    ends_at: null,
    place_name: null,
    address: null,
    lat: null,
    lng: null,
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
    `select public.schedule_admin_save('${operation}',${id ? `'${id}'` : 'null'},${revision ?? 'null'},'${JSON.stringify(input(artist, patch))}'::jsonb,true);`,
  );
const remove = (actor, id, revision, operation = uuid()) =>
  authenticated(
    actor,
    `select public.schedule_admin_delete('${operation}','${id}',${revision},true);`,
  );
async function fixtures(db) {
  const admin = uuid();
  const other = uuid();
  const artist = uuid();
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values('${admin}','${admin}@example.invalid','{}'),('${other}','${other}@example.invalid','{}');
    update public.profiles set role='admin',call_name='가상일정팬',onboarding_completed_at=clock_timestamp() where id in('${admin}','${other}');
    insert into public.artists(id,slug,name,grade,status) values('${artist}','schedule-race-${artist}','Fictional schedule race artist','B','active');`);
  const event = JSON.parse(
    await db.query(`begin; ${save(admin, artist)} commit;`),
  );
  return { admin, other, artist, event };
}
async function current(db, id) {
  const raw = await db.query(
    `select private.schedule_admin_projection('${id}');`,
  );
  return raw ? JSON.parse(raw) : null;
}
async function run(db) {
  {
    const { admin, artist } = await fixtures(db);
    const operation = uuid();
    const sql = save(admin, artist, null, null, operation);
    const result = await race(db, 'duplicate-create', sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    assert.equal(
      await db.query(
        `select count(*) from private.schedule_admin_operations where operation_id='${operation}';`,
      ),
      '1',
    );
    assert.equal(
      await db.query(
        `select count(*) from public.schedules where artist_id='${artist}';`,
      ),
      '2',
    );
    console.info(
      'PASS: identical concurrent create requests produce one new schedule and one immutable receipt',
    );
  }
  {
    const { admin, artist } = await fixtures(db);
    const operation = uuid();
    const result = await race(
      db,
      'operation-reuse',
      save(admin, artist, null, null, operation),
      save(admin, artist, null, null, operation, { title: 'Different input' }),
    );
    expectedError(result, 'SCHEDULE_OPERATION_CONFLICT');
    console.info(
      'PASS: changed create input cannot reuse an in-flight operation key',
    );
  }
  {
    const { admin, other, artist, event } = await fixtures(db);
    const result = await race(
      db,
      'edit-cas',
      save(admin, artist, event.id, event.revision, uuid(), {
        title: 'Winner',
      }),
      save(other, artist, event.id, event.revision, uuid(), {
        title: 'Stale loser',
      }),
    );
    expectedError(result, 'SCHEDULE_REVISION_CONFLICT');
    assert.equal((await current(db, event.id)).title, 'Winner');
    assert.equal((await current(db, event.id)).revision, 2);
    console.info(
      'PASS: two administrators serialize edits and stale loser cannot overwrite',
    );
  }
  {
    const { admin, artist, event } = await fixtures(db);
    const operation = uuid();
    const sql = save(admin, artist, event.id, event.revision, operation, {
      title: 'Updated once',
    });
    const result = await race(db, 'duplicate-update', sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    assert.equal((await current(db, event.id)).revision, 2);
    console.info('PASS: duplicate in-flight edits increment revision once');
  }
  {
    const { admin, other, artist, event } = await fixtures(db);
    const result = await race(
      db,
      'delete-before-edit',
      remove(admin, event.id, event.revision),
      save(other, artist, event.id, event.revision),
    );
    expectedError(result, 'SCHEDULE_UNAVAILABLE');
    assert.equal(await current(db, event.id), null);
    console.info(
      'PASS: deleted event is not recreated by a blocked stale update',
    );
  }
  {
    const { admin, other, artist, event } = await fixtures(db);
    const result = await race(
      db,
      'edit-before-delete',
      save(admin, artist, event.id, event.revision),
      remove(other, event.id, event.revision),
    );
    expectedError(result, 'SCHEDULE_REVISION_CONFLICT');
    assert.equal((await current(db, event.id)).revision, 2);
    console.info('PASS: blocked stale delete cannot erase a newer event edit');
  }
  {
    const { admin, event } = await fixtures(db);
    const sql = remove(admin, event.id, event.revision);
    const result = await race(db, 'duplicate-delete', sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    assert.equal(
      await db.query(
        `select count(*) from public.calendar_audit_log where target_id='${event.id}' and action='delete';`,
      ),
      '1',
    );
    console.info(
      'PASS: repeated deletion replays accepted result and audits once',
    );
  }
  for (const kind of ['role', 'restriction']) {
    const { admin, artist, event } = await fixtures(db);
    const mutation = kind === 'role' ? "role='fan'" : 'is_restricted=true';
    const result = await race(
      db,
      `loss-${kind}`,
      `update public.profiles set ${mutation} where id='${admin}';`,
      save(admin, artist, event.id, event.revision),
    );
    expectedError(result, 'CALENDAR_FORBIDDEN');
    assert.equal((await current(db, event.id)).revision, 1);
    console.info(
      `PASS: concurrent ${kind} revocation is rechecked after profile lock wait`,
    );
  }
  {
    const { admin, event } = await fixtures(db);
    const result = await race(
      db,
      'read-role-loss',
      `update public.profiles set role='fan' where id='${admin}';`,
      authenticated(admin, `select public.schedule_admin_get('${event.id}');`),
    );
    expectedError(result, 'CALENDAR_FORBIDDEN');
    console.info(
      'PASS: administrative reads cannot expose draft data after a waited role revocation',
    );
  }
  {
    const { admin } = await fixtures(db);
    const result = await race(
      db,
      'filter-restriction',
      `update public.profiles set is_restricted=true where id='${admin}';`,
      authenticated(admin, 'select public.schedule_my_artists();'),
    );
    expectedError(result, 'CALENDAR_FORBIDDEN');
    console.info(
      'PASS: personal filter read reevaluates a waited account restriction',
    );
  }
  {
    const { admin, artist, event } = await fixtures(db);
    const result = await race(
      db,
      'operator-before-cas',
      `update public.schedules set title='Operator event update' where id='${event.id}';`,
      save(admin, artist, event.id, event.revision),
    );
    expectedError(result, 'SCHEDULE_REVISION_CONFLICT');
    assert.equal((await current(db, event.id)).title, 'Operator event update');
    console.info(
      'PASS: privileged direct event update invalidates a previously loaded form',
    );
  }
  {
    const { admin, other, artist, event } = await fixtures(db);
    const result = await race(
      db,
      'legacy-before-cas',
      authenticated(
        admin,
        `select public.schedule_update('${event.id}','concert','Legacy event update','2028-02-10T10:00:00+09:00');`,
      ),
      save(other, artist, event.id, event.revision),
    );
    expectedError(result, 'SCHEDULE_REVISION_CONFLICT');
    assert.equal((await current(db, event.id)).title, 'Legacy event update');
    console.info(
      'PASS: compatible legacy event updates invalidate new CAS without lost data',
    );
  }
  {
    const { admin, artist } = await fixtures(db);
    const operation = uuid();
    const sql = save(admin, artist, null, null, operation);
    await db.query(`begin; ${sql} commit;`);
    const result = await race(
      db,
      'replay-role-loss',
      `update public.profiles set role='fan' where id='${admin}';`,
      sql,
    );
    expectedError(result, 'CALENDAR_FORBIDDEN');
    console.info(
      'PASS: an accepted receipt cannot bypass current authority on replay',
    );
  }
}
try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(
      `select (select count(*) from auth.users)+(select count(*) from public.schedules)+(select count(*) from private.schedule_admin_operations);`,
    ),
    '0',
    'Use freshly reset disposable local database; this script restores it afterward.',
  );
  shouldReset = true;
  await run(db);
  console.info(
    'All schedule management PostgreSQL independent-session races passed.',
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
