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
const expectedCases = 17;

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
    this.label = `attendance-points-concurrency-${label}`;
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
    const marker = `ATTENDANCE_POINTS_TEST_DONE_${++commandSequence}`;
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
async function race(
  db,
  label,
  firstSql,
  secondSql,
  onBlocked,
  finalize = 'commit',
) {
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
    assert.ok(finalize === 'commit' || finalize === 'rollback');
    await first.query(`${finalize};`);
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

const attendance = (actor, operation = uuid()) =>
  authenticated(
    actor,
    `select public.point_ui_check_attendance('${operation}');`,
  );
const raw = (actor) =>
  authenticated(actor, 'select public.point_check_attendance();');
const snapshot = (actor) =>
  authenticated(actor, 'select public.point_ui_snapshot();');
const committed = (db, sql) => db.query(`begin; ${sql} commit;`);
async function fixtures(db) {
  const f = { fan: uuid(), other: uuid(), admin: uuid() };
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values
    ('${f.fan}','${f.fan}@example.invalid','{}'),('${f.other}','${f.other}@example.invalid','{}'),('${f.admin}','${f.admin}@example.invalid','{}');
    update public.profiles set call_name='가상출석팬',onboarding_completed_at=clock_timestamp() where id in('${f.fan}','${f.other}','${f.admin}');
    update public.profiles set role='admin' where id='${f.admin}';
    insert into private.point_policy(singleton,version,attendance_amount,post_amount,comment_amount,post_daily_cap,comment_daily_cap,deleted_content_treatment)
    values(true,'fictional-attendance-race',10,0,0,0,0,'retain')
    on conflict(singleton) do update set version='fictional-attendance-race',attendance_amount=10;`);
  return f;
}
async function counts(db, actor, entries, operations, balance) {
  assert.deepEqual(
    JSON.parse(
      await db.query(`select jsonb_build_object(
    'entries',(select count(*) from private.point_ledger where user_id='${actor}' and reason='attendance'),
    'operations',(select count(*) from private.point_attendance_operations where actor_id='${actor}'),
    'balance',(select coalesce(sum(amount),0) from private.point_ledger where user_id='${actor}'));`),
    ),
    { entries, operations, balance },
  );
}
const correction = (f, amount) =>
  authenticated(
    f.admin,
    `select public.point_admin_adjust('${f.fan}','${uuid()}',${amount},'Fictional range correction');`,
  );
async function run(db) {
  {
    const f = await fixtures(db);
    const sql = attendance(f.fan);
    const result = await race(db, 'duplicate-operation', sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    await counts(db, f.fan, 1, 1, 10);
    console.info(
      'PASS: exact operation race keeps one award and one immutable receipt',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'distinct-same-day',
      attendance(f.fan),
      attendance(f.fan),
    );
    assert.equal(
      JSON.parse(value(result)).entry_id,
      JSON.parse(result.winner).entry_id,
    );
    await counts(db, f.fan, 1, 2, 10);
    console.info(
      'PASS: different same-day operations share one legacy attendance entry',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'raw-before-ui',
      raw(f.fan),
      attendance(f.fan),
    );
    assert.equal(JSON.parse(value(result)).entry_id, result.winner);
    await counts(db, f.fan, 1, 1, 10);
    console.info('PASS: legacy writer before UI cannot double-credit');
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'ui-before-raw',
      attendance(f.fan),
      raw(f.fan),
    );
    assert.equal(value(result), JSON.parse(result.winner).entry_id);
    await counts(db, f.fan, 1, 1, 10);
    console.info('PASS: UI writer before legacy cannot double-credit');
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'award-before-snapshot',
      attendance(f.fan),
      snapshot(f.fan),
    );
    const page = JSON.parse(value(result));
    const receipt = JSON.parse(result.winner);
    assert.equal(page.balance, 10);
    assert.equal(page.attendance_entry_id, receipt.entry_id);
    assert.equal(page.entries[0].id, receipt.entry_id);
    assert.equal(page.entries.length, 1);
    console.info(
      'PASS: waiting snapshot sees committed attendance and exact balance together',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'snapshot-before-award',
      snapshot(f.fan),
      attendance(f.fan),
    );
    const page = JSON.parse(result.winner);
    assert.equal(page.balance, 0);
    assert.equal(page.attendance_entry_id, null);
    assert.deepEqual(page.entries, []);
    assert.equal(JSON.parse(value(result)).amount, 10);
    await counts(db, f.fan, 1, 1, 10);
    console.info(
      'PASS: snapshot SHARE lock prevents torn balance/history while award waits',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'restriction-before-write',
      `update public.profiles set is_restricted=true where id='${f.fan}';`,
      attendance(f.fan),
    );
    expectedError(result, 'COMMUNITY_FORBIDDEN');
    await counts(db, f.fan, 0, 0, 0);
    console.info(
      'PASS: attendance rechecks current restriction after actor lock wait',
    );
  }
  {
    const f = await fixtures(db);
    await committed(db, attendance(f.fan));
    const result = await race(
      db,
      'restriction-before-snapshot',
      `update public.profiles set is_restricted=true where id='${f.fan}';`,
      snapshot(f.fan),
    );
    expectedError(result, 'COMMUNITY_FORBIDDEN');
    await counts(db, f.fan, 1, 1, 10);
    console.info(
      'PASS: private history is not exposed after restriction wins its lock',
    );
  }
  {
    const f = await fixtures(db);
    const operation = uuid();
    await committed(db, attendance(f.fan, operation));
    const result = await race(
      db,
      'restriction-before-replay',
      `update public.profiles set is_restricted=true where id='${f.fan}';`,
      attendance(f.fan, operation),
    );
    expectedError(result, 'COMMUNITY_FORBIDDEN');
    await counts(db, f.fan, 1, 1, 10);
    console.info('PASS: receipt recovery cannot bypass current restriction');
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'expired-restriction-after-wait',
      `update public.profiles set is_restricted=true,restricted_until=clock_timestamp()+interval '1 second' where id='${f.fan}';`,
      attendance(f.fan),
      async () => {
        await db.query('select pg_sleep(1.1);');
      },
    );
    assert.equal(JSON.parse(value(result)).amount, 10);
    await counts(db, f.fan, 1, 1, 10);
    console.info(
      'PASS: restriction expiry uses wall clock after waiting rather than transaction start',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'policy-removed-before-award',
      'delete from private.point_policy;',
      attendance(f.fan),
    );
    expectedError(result, 'POINT_POLICY_UNCONFIGURED');
    await counts(db, f.fan, 0, 0, 0);
    console.info(
      'PASS: policy deletion while waiting fails closed without a success receipt',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'policy-changed-before-award',
      "update private.point_policy set attendance_amount=23,version='fictional-new-race';",
      attendance(f.fan),
    );
    assert.equal(JSON.parse(value(result)).amount, 23);
    await counts(db, f.fan, 1, 1, 23);
    assert.equal(
      await db.query(
        `select policy_version from private.point_ledger where user_id='${f.fan}';`,
      ),
      'fictional-new-race',
    );
    console.info(
      'PASS: award uses exact committed policy after policy lock wait',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'policy-changed-before-snapshot',
      'update private.point_policy set attendance_amount=37;',
      snapshot(f.fan),
    );
    assert.equal(JSON.parse(value(result)).attendance_amount, 37);
    await counts(db, f.fan, 0, 0, 0);
    console.info(
      'PASS: snapshot exposes only the current approved amount after policy wait',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'onboarding-revoked-before-write',
      `update public.profiles set onboarding_completed_at=null where id='${f.fan}';`,
      attendance(f.fan),
    );
    expectedError(result, 'COMMUNITY_FORBIDDEN');
    await counts(db, f.fan, 0, 0, 0);
    console.info('PASS: waiting attendance cannot use stale fan readiness');
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'correction-before-attendance',
      correction(f, 9007199254740991),
      attendance(f.fan),
    );
    expectedError(result, 'POINT_BALANCE_OUT_OF_RANGE');
    await counts(db, f.fan, 0, 0, 9007199254740991);
    console.info(
      'PASS: legacy correction and attendance serialize shared safe-integer balance',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'attendance-before-correction',
      attendance(f.fan),
      correction(f, -10),
    );
    value(result);
    await counts(db, f.fan, 1, 1, 0);
    assert.equal(JSON.parse(await committed(db, snapshot(f.fan))).balance, 0);
    console.info(
      'PASS: correction waiting for attendance sees committed amount without lost update',
    );
  }
  {
    const f = await fixtures(db);
    const sql = attendance(f.fan);
    const result = await race(
      db,
      'rollback-before-retry',
      sql,
      sql,
      undefined,
      'rollback',
    );
    assert.equal(JSON.parse(value(result)).amount, 10);
    await counts(db, f.fan, 1, 1, 10);
    console.info(
      'PASS: rolled-back operation leaves no phantom receipt and waiting retry awards once',
    );
  }
}
try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(
      `select (select count(*) from auth.users)+(select count(*) from private.point_policy)+(select count(*) from private.point_ledger)+(select count(*) from private.point_attendance_operations);`,
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
    'Every declared attendance race executed.',
  );
  console.info(
    `All ${completedCases} attendance points PostgreSQL independent-session races passed in ${Math.round(performance.now() - startedAt)}ms.`,
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
