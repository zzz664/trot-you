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
    this.label = `admin-subscriptions-concurrency-${label}`;
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
    const marker = `ADMIN_SUBSCRIPTIONS_TEST_DONE_${++commandSequence}`;
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
const dashboard = (actor, artist) =>
  authenticated(
    actor,
    `select public.admin_subscription_dashboard((clock_timestamp() at time zone 'Asia/Seoul')::date-6,(clock_timestamp() at time zone 'Asia/Seoul')::date,'${artist}');`,
  );
async function fixture(db) {
  const admin = uuid();
  const fan = uuid();
  const artist = uuid();
  const subscription = uuid();
  const event = uuid();
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values('${admin}','${admin}@example.invalid','{}'),('${fan}','${fan}@example.invalid','{}');
    update public.profiles set role='admin' where id='${admin}';
    insert into public.artists(id,slug,name,grade,status) values('${artist}','dashboard-race-${artist}','Fictional dashboard race','B','active');
    insert into public.subscriptions(id,user_id,artist_id,provider,status,current_period_start,current_period_end,next_billing_at)
    values('${subscription}','${fan}','${artist}','toss','active',now()-interval '1 day',now()+interval '29 days',now()+interval '29 days');
    insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at,recorded_at)
    values('${event}','${subscription}','charge',1000,'toss',now()-interval '1 day',now()+interval '29 days',now()-interval '1 day',now()-interval '1 day');
    insert into private.payment_event_verifications(event_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
    values('${event}','toss','test','fictional-dashboard-race','${event}','${uuid()}');`);
  return { admin, fan, artist, subscription };
}
async function read(db, f) {
  return JSON.parse(
    await db.query(`begin; ${dashboard(f.admin, f.artist)} commit;`),
  );
}
async function run(db) {
  for (const kind of ['role', 'restriction']) {
    const f = await fixture(db);
    const mutation = kind === 'role' ? "role='fan'" : 'is_restricted=true';
    const result = await race(
      db,
      `loss-${kind}`,
      `update public.profiles set ${mutation} where id='${f.admin}';`,
      dashboard(f.admin, f.artist),
    );
    expectedError(result, 'ADMIN_SUBSCRIPTIONS_FORBIDDEN');
    console.info(
      `PASS: ${kind} loss committed while waiting is rechecked before dashboard disclosure`,
    );
  }
  for (const kind of ['role', 'restriction']) {
    const f = await fixture(db);
    const mutation = kind === 'role' ? "role='fan'" : 'is_restricted=true';
    const result = await race(
      db,
      `read-before-${kind}`,
      dashboard(f.admin, f.artist),
      `update public.profiles set ${mutation} where id='${f.admin}'; select 'changed';`,
    );
    assert.equal(JSON.parse(result.winner).summary.current.active_paid, 1);
    assert.equal(value(result), 'changed');
    console.info(
      `PASS: already-authorized read fences ${kind} loss until its transaction finishes`,
    );
  }
  {
    const f = await fixture(db);
    const result = await race(
      db,
      'same-cancel',
      authenticated(
        f.fan,
        `select (public.cancel_subscription('${f.subscription}')).id;`,
      ),
      authenticated(
        f.fan,
        `select (public.cancel_subscription('${f.subscription}')).id;`,
      ),
    );
    assert.equal(result.winner, f.subscription);
    assert.equal(value(result), f.subscription);
    assert.equal(
      await db.query(
        `select count(*) from private.subscription_cancellation_history where subscription_id='${f.subscription}';`,
      ),
      '1',
    );
    const after = await read(db, f);
    assert.equal(after.summary.current.active_paid, 0);
    assert.equal(after.summary.current.canceled_paid, 1);
    assert.equal(after.summary.period.cancellations, 1);
    console.info(
      'PASS: concurrent duplicate cancellation produces one immutable event and one paid-state transition',
    );
  }
  {
    const f = await fixture(db);
    const writer = await session('snapshot-writer');
    try {
      await writer.query(
        `begin; ${authenticated(f.fan, `select (public.cancel_subscription('${f.subscription}')).id;`)}`,
      );
      const before = await read(db, f);
      assert.equal(before.summary.current.active_paid, 1);
      assert.equal(before.summary.current.canceled_paid, 0);
      assert.equal(before.summary.period.cancellations, 0);
      assert.deepEqual(
        before.summary,
        before.artists[0] && {
          current: before.artists[0].current,
          period: before.artists[0].period,
        },
      );
      await writer.query('commit;');
      const after = await read(db, f);
      assert.equal(after.summary.current.active_paid, 0);
      assert.equal(after.summary.current.canceled_paid, 1);
      assert.equal(after.summary.period.cancellations, 1);
      assert.deepEqual(after.summary, {
        current: after.artists[0].current,
        period: after.artists[0].period,
      });
      console.info(
        'PASS: uncommitted billing transaction exposes neither half; committed current state, history, summary and row agree',
      );
    } finally {
      await writer.close();
    }
  }
  {
    const f = await fixture(db);
    const result = await race(
      db,
      'snapshot-after-authority-wait',
      `select 1 from public.profiles where id='${f.admin}' for update;
      update public.subscriptions set status='canceled',canceled_at=clock_timestamp(),next_billing_at=null where id='${f.subscription}';`,
      dashboard(f.admin, f.artist),
    );
    const after = JSON.parse(value(result));
    assert.equal(after.summary.current.active_paid, 0);
    assert.equal(after.summary.current.canceled_paid, 1);
    assert.equal(after.summary.period.cancellations, 1);
    assert.deepEqual(after.summary, {
      current: after.artists[0].current,
      period: after.artists[0].period,
    });
    console.info(
      'PASS: statement snapshot begins after authority wait and observes the full committed transaction',
    );
  }
  for (const isolation of ['repeatable read', 'serializable']) {
    const f = await fixture(db);
    const client = await session(`isolation-${isolation.replace(' ', '-')}`);
    try {
      const outcome = await client
        .query(
          `begin isolation level ${isolation}; ${dashboard(f.admin, f.artist)} commit;`,
        )
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      assert.match(
        String(outcome.error),
        /ADMIN_SUBSCRIPTIONS_ISOLATION_UNSUPPORTED/,
      );
      console.info(`PASS: stale ${isolation} snapshot is rejected explicitly`);
    } finally {
      await client.close();
    }
  }
}
try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(`select (select count(*) from auth.users)+(select count(*) from public.subscriptions)+(select count(*) from public.payment_events)
    +(select count(*) from private.subscription_cancellation_history);`),
    '0',
    'Use freshly reset disposable local database only.',
  );
  shouldReset = true;
  await run(db);
  console.info(
    'All admin subscription PostgreSQL independent-session races passed.',
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.all([...clients].map((client) => client.close()));
  if (shouldReset)
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
