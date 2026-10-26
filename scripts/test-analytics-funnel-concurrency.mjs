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
const expectedCases = 16;

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
    this.label = `analytics-funnel-concurrency-${label}`;
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
    const marker = `ANALYTICS_FUNNEL_TEST_DONE_${++commandSequence}`;
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

const consentVersion = 'd3900000-0000-4000-8000-000000000001';
const rotatedVersion = 'd3900000-0000-4000-8000-000000000002';
const committed = (db, sql) => db.query(`begin; ${sql} commit;`);
const consent = (actor, granted) =>
  authenticated(
    actor,
    `select public.analytics_set_consent(${granted},'${consentVersion}');`,
  );
const collect = (actor, key = uuid(), context = 'reply') =>
  authenticated(
    actor,
    `select public.analytics_record_client('${key}','voice_input_used',p_voice_context=>'${context}');`,
  );
const captureSignup = (actor) =>
  `set local role service_role; select public.analytics_capture_server('${actor}','${actor}','signup_complete');`;
const dashboard = (actor) =>
  authenticated(
    actor,
    `select public.admin_analytics_dashboard((clock_timestamp() at time zone 'Asia/Seoul')::date,(clock_timestamp() at time zone 'Asia/Seoul')::date);`,
  );
const eventCount = (page, name = 'voice_input_used') =>
  page.events.find((entry) => entry.name === name).event_count;
const storedCount = (db, actor) =>
  db.query(
    `select count(*) from private.analytics_events where user_id='${actor}';`,
  );
function assertPrivateProjection(page, f) {
  assert.equal(page.actor_id, f.admin);
  assert.equal(page.events.length, 13);
  assert.equal(new Set(page.events.map((entry) => entry.name)).size, 13);
  assert.deepEqual(page.business_metrics, {
    configured: false,
    reason: 'definitions_unapproved',
    expected_count: 4,
  });
  assert.equal(page.coverage.history_complete, false);
  assert.equal(page.coverage.mode, 'current_consent_observations');
  assert.ok(!JSON.stringify(page).includes(f.fan));
  assert.ok(!JSON.stringify(page).includes('@example.invalid'));
  assert.ok(!JSON.stringify(page).includes('Fictional private profile'));
  for (const entry of page.events)
    assert.deepEqual(Object.keys(entry).sort(), ['event_count', 'name']);
  for (const entry of page.daily)
    assert.deepEqual(Object.keys(entry).sort(), [
      'day_kst',
      'event_count',
      'name',
    ]);
}
async function fixture(db, observation = true) {
  const f = { fan: uuid(), admin: uuid(), key: uuid() };
  // Every test starts with isolated fictional observation storage. Source/state
  // preservation is verified separately by the populated upgrade runner.
  await db.query(`delete from private.analytics_events;
    insert into private.analytics_policy(singleton,consent_version,enabled,retention_days)
    values(true,'${consentVersion}',true,30) on conflict(singleton) do update
    set consent_version=excluded.consent_version,enabled=true,retention_days=30;
    insert into auth.users(id,email,raw_user_meta_data) values
    ('${f.fan}','${f.fan}@example.invalid','{}'),('${f.admin}','${f.admin}@example.invalid','{}');
    update public.profiles set call_name='Fictional private profile',onboarding_completed_at=clock_timestamp() where id in('${f.fan}','${f.admin}');
    update public.profiles set role='admin' where id='${f.admin}';`);
  await committed(db, consent(f.fan, true));
  // A real new source timestamp follows the explicit fictional consent epoch.
  await db.query(
    `update public.profiles set onboarding_completed_at=clock_timestamp() where id='${f.fan}';`,
  );
  if (observation) await committed(db, collect(f.fan, f.key));
  return f;
}
async function run(db) {
  await db.query(`insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
    ('${consentVersion}','analytics','Fictional analytics race consent','Fictional disposable CI fixture; not approved real policy.',clock_timestamp(),clock_timestamp()),
    ('${rotatedVersion}','analytics','Fictional rotated analytics race consent','Fictional disposable CI fixture; not approved real policy.',clock_timestamp(),clock_timestamp());`);
  {
    const f = await fixture(db);
    const result = await race(
      db,
      'admin-demotion-before-read',
      `update public.profiles set role='fan' where id='${f.admin}';`,
      dashboard(f.admin),
    );
    expectedError(result, 'ANALYTICS_DASHBOARD_FORBIDDEN');
    assert.equal(await storedCount(db, f.fan), '1');
    console.info(
      'PASS: current admin demotion wins before aggregate read without mutating observations',
    );
  }
  {
    const f = await fixture(db);
    const result = await race(
      db,
      'admin-restriction-before-read',
      `update public.profiles set is_restricted=true where id='${f.admin}';`,
      dashboard(f.admin),
    );
    expectedError(result, 'ANALYTICS_DASHBOARD_FORBIDDEN');
    assert.equal(await storedCount(db, f.fan), '1');
    console.info(
      'PASS: current admin restriction prevents aggregate disclosure after lock wait',
    );
  }
  {
    const f = await fixture(db);
    const result = await race(
      db,
      'admin-rollback-before-read',
      `update public.profiles set role='fan' where id='${f.admin}';`,
      dashboard(f.admin),
      undefined,
      'rollback',
    );
    const page = JSON.parse(value(result));
    assertPrivateProjection(page, f);
    assert.equal(eventCount(page), 1);
    console.info(
      'PASS: rolled-back authority changes do not fabricate a permanent aggregate denial',
    );
  }
  {
    const f = await fixture(db);
    const result = await race(
      db,
      'admin-restriction-expiry',
      `update public.profiles set is_restricted=true,restricted_until=clock_timestamp()+interval '1 second' where id='${f.admin}';`,
      dashboard(f.admin),
      async () => {
        await db.query('select pg_sleep(1.1);');
      },
    );
    const page = JSON.parse(value(result));
    assertPrivateProjection(page, f);
    assert.equal(eventCount(page), 1);
    console.info(
      'PASS: aggregate authority checks restriction expiry using wall clock after waiting',
    );
  }
  {
    const f = await fixture(db);
    const result = await race(
      db,
      'policy-disable-before-read',
      'update private.analytics_policy set enabled=false;',
      dashboard(f.admin),
    );
    const page = JSON.parse(value(result));
    assertPrivateProjection(page, f);
    assert.equal(page.collection.status, 'disabled');
    assert.ok(page.events.every((entry) => entry.event_count === null));
    assert.deepEqual(page.daily, []);
    assert.equal(await storedCount(db, f.fan), '1');
    console.info(
      'PASS: disabled collection is unavailable rather than a false zero and preserves retained history',
    );
  }
  {
    const f = await fixture(db);
    const result = await race(
      db,
      'policy-version-before-read',
      `update private.analytics_policy set consent_version='${rotatedVersion}';`,
      dashboard(f.admin),
    );
    const page = JSON.parse(value(result));
    assertPrivateProjection(page, f);
    assert.equal(page.collection.status, 'enabled');
    assert.equal(eventCount(page), 0);
    assert.deepEqual(page.daily, []);
    assert.equal(await storedCount(db, f.fan), '1');
    console.info(
      'PASS: a rotated policy excludes old-version consent from current aggregates without rewriting events',
    );
  }
  {
    const f = await fixture(db);
    const result = await race(
      db,
      'withdraw-before-read',
      consent(f.fan, false),
      dashboard(f.admin),
    );
    const page = JSON.parse(value(result));
    assertPrivateProjection(page, f);
    assert.equal(eventCount(page), 0);
    assert.equal(await storedCount(db, f.fan), '1');
    console.info(
      'PASS: committed withdrawal removes prior observation from current aggregate visibility',
    );
  }
  {
    const f = await fixture(db);
    const result = await race(
      db,
      'renewed-grant-before-read',
      `${consent(f.fan, false)} select public.analytics_set_consent(true,'${consentVersion}');`,
      dashboard(f.admin),
    );
    const page = JSON.parse(value(result));
    assertPrivateProjection(page, f);
    assert.equal(eventCount(page), 0);
    assert.equal(await storedCount(db, f.fan), '1');
    console.info(
      'PASS: a new consent epoch cannot make observations from before its grant visible again',
    );
  }
  {
    const f = await fixture(db);
    const result = await race(
      db,
      'fan-restriction-before-read',
      `update public.profiles set is_restricted=true where id='${f.fan}';`,
      dashboard(f.admin),
    );
    const page = JSON.parse(value(result));
    assertPrivateProjection(page, f);
    assert.equal(eventCount(page), 0);
    assert.equal(await storedCount(db, f.fan), '1');
    console.info(
      'PASS: current fan eligibility is re-evaluated after profile lock wait before counts',
    );
  }
  {
    const f = await fixture(db, false);
    const result = await race(
      db,
      'intake-before-withdraw',
      captureSignup(f.fan),
      consent(f.fan, false),
    );
    value(result);
    assert.equal(await storedCount(db, f.fan), '1');
    const page = JSON.parse(await committed(db, dashboard(f.admin)));
    assertPrivateProjection(page, f);
    assert.equal(eventCount(page, 'signup_complete'), 0);
    assert.equal(
      await db.query(
        `select name from private.analytics_events where user_id='${f.fan}';`,
      ),
      'signup_complete',
    );
    console.info(
      'PASS: new server capture before withdrawal retains one accepted row but later dashboard excludes it',
    );
  }
  {
    const f = await fixture(db, false);
    const result = await race(
      db,
      'withdraw-before-intake',
      consent(f.fan, false),
      captureSignup(f.fan),
    );
    expectedError(result, 'ANALYTICS_CONSENT_REQUIRED');
    assert.equal(await storedCount(db, f.fan), '0');
    console.info(
      'PASS: new server capture waiting behind withdrawal cannot append under stale consent',
    );
  }
  {
    const f = await fixture(db, false);
    const sql = collect(f.fan, f.key);
    const result = await race(db, 'duplicate-intake', sql, sql);
    assert.equal(value(result), result.winner);
    assert.equal(await storedCount(db, f.fan), '1');
    const page = JSON.parse(await committed(db, dashboard(f.admin)));
    assertPrivateProjection(page, f);
    assert.equal(eventCount(page), 1);
    console.info(
      'PASS: concurrent observation replay produces exactly one retained aggregate event',
    );
  }
  {
    const f = await fixture(db, false);
    const result = await race(
      db,
      'policy-disable-before-capture',
      'update private.analytics_policy set enabled=false;',
      captureSignup(f.fan),
    );
    expectedError(result, 'ANALYTICS_CAPTURE_POLICY_REQUIRED');
    assert.equal(await storedCount(db, f.fan), '0');
    const page = JSON.parse(await committed(db, dashboard(f.admin)));
    assertPrivateProjection(page, f);
    assert.equal(page.collection.status, 'disabled');
    assert.ok(page.events.every((entry) => entry.event_count === null));
    console.info(
      'PASS: new server capture rechecks a disabled approved policy after waiting and records nothing',
    );
  }
  {
    const f = await fixture(db, false);
    const sql = collect(f.fan, f.key);
    const result = await race(
      db,
      'rollback-intake',
      sql,
      sql,
      undefined,
      'rollback',
    );
    assert.notEqual(value(result), result.winner);
    assert.equal(await storedCount(db, f.fan), '1');
    console.info(
      'PASS: rolled-back ingestion never reserves an event key or contributes an extra count',
    );
  }
  {
    const f = await fixture(db);
    const result = await race(
      db,
      'read-before-withdraw',
      dashboard(f.admin),
      consent(f.fan, false),
    );
    const page = JSON.parse(result.winner);
    assertPrivateProjection(page, f);
    assert.equal(eventCount(page), 1);
    value(result);
    assert.equal(
      eventCount(JSON.parse(await committed(db, dashboard(f.admin)))),
      0,
    );
    assert.equal(await storedCount(db, f.fan), '1');
    console.info(
      'PASS: aggregate snapshot completes before waiting withdrawal and next read reflects withdrawal',
    );
  }
  {
    const f = await fixture(db);
    const result = await race(
      db,
      'read-before-disable',
      dashboard(f.admin),
      'update private.analytics_policy set enabled=false;',
    );
    const page = JSON.parse(result.winner);
    assertPrivateProjection(page, f);
    assert.equal(page.collection.status, 'enabled');
    assert.equal(eventCount(page), 1);
    value(result);
    const next = JSON.parse(await committed(db, dashboard(f.admin)));
    assert.equal(next.collection.status, 'disabled');
    assert.ok(next.events.every((entry) => entry.event_count === null));
    console.info(
      'PASS: a held dashboard policy snapshot precedes disable and a later read reports unavailable',
    );
  }
}

try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(`select
    (select count(*) from auth.users)+
    (select count(*) from public.profiles)+
    (select count(*) from private.analytics_events)+
    (select count(*) from private.analytics_consents)+
    (select count(*) from private.analytics_policy)+
    (select count(*) from private.onboarding_documents)+
    (select count(*) from public.subscriptions)+
    (select count(*) from public.payment_events)+
    (select count(*) from public.posts)+
    (select count(*) from private.point_ledger)+
    (select count(*) from storage.objects);`),
    '0',
    'Use a freshly reset disposable local database with fictional seeds only; this test resets it afterward.',
  );
  shouldReset = true;
  await run(db);
  assert.equal(
    completedCases,
    expectedCases,
    'Every declared race must execute and observe a real blocking pair.',
  );
  console.info(
    `All ${completedCases} PostgreSQL multi-session analytics funnel races passed.`,
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
        'Analytics funnel fixture cleanup failed. Reset the disposable database before reuse.',
        error,
      );
      process.exitCode = 1;
    }
  }
}
