import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
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
    this.label = `billing-notice-concurrency-${label}`;
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
    const marker = `BILLING_NOTICE_TEST_DONE_${++commandSequence}`;
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

const service = (sql) => `set local role service_role; ${sql}`;
const fan = 'c1000000-0000-4000-8000-000000000001';
const sessionId = 'c1100000-0000-4000-8000-000000000001';
const policy = 'c7000000-0000-4000-8000-000000000001';
const otherPolicy = 'c7000000-0000-4000-8000-000000000002';
const create = (sid) =>
  service(
    `select row_to_json(n) from public.billing_notice_create('${sid}') n;`,
  );
const countCreate = (sid) =>
  service(`select count(*) from public.billing_notice_create('${sid}');`);
const cancel = (sid) =>
  `update public.subscriptions set status='canceled',canceled_at=clock_timestamp(),next_billing_at=null where id='${sid}';`;
const preference = (enabled) =>
  authenticated(
    fan,
    `select billing_enabled from public.billing_notice_set_preference(${enabled});`,
  );
const changePolicy = (id) =>
  `update private.checkout_policy_current set policy_version='${id}';`;
const prepare = (f) =>
  service(
    `select count(*) from public.webpush_prepare_delivery('${f.job}','${f.token}');`,
  );
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
async function fixture(db, label, withNotice = false, claim = false) {
  await db.query(`${changePolicy(policy)} begin; ${preference(true)} commit;`);
  const sid = await db.query(`select pg_temp.make_case('${label}');`);
  const f = { sid };
  if (withNotice) {
    const created = JSON.parse(await db.query(`begin; ${create(sid)} commit;`));
    assert.equal(created.created, true);
    assert.equal(created.push_jobs, 1);
    f.notice = created.notice_id;
    f.job = await db.query(
      `select id from private.notification_jobs where billing_notice_id='${f.notice}';`,
    );
    if (claim) {
      f.token = await db.query(
        `begin; ${service(`select lease_token from public.notification_claim('${f.job}');`)} commit;`,
      );
      assert.match(f.token, /^[a-f0-9-]{36}$/);
    }
  }
  return f;
}
async function run(db) {
  await db.query(
    readFileSync(
      new URL('./billing-notice-fixture.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.query(`insert into private.notification_policy values(true,'fictional-notice-push','fictional-notice-consent',true,3,10,30,86400);
    insert into auth.sessions(id,user_id,created_at,updated_at) values('${sessionId}','${fan}',now(),now());
    begin; ${service(`select public.webpush_register_device('${fan}','${sessionId}','https://push.example.invalid/billing-race',repeat('B',87),repeat('A',22),'fictional-notice-consent');`)} commit;`);
  {
    const f = await fixture(db, 'duplicate');
    const result = await race(db, 'duplicate', create(f.sid), create(f.sid));
    assert.equal(JSON.parse(result.winner).created, true);
    assert.equal(JSON.parse(value(result)).created, false);
    assert.equal(
      await db.query(
        `select count(*) from private.billing_notices where subscription_id='${f.sid}';`,
      ),
      '1',
    );
    assert.equal(
      await db.query(
        `select count(*) from private.notification_jobs j join private.billing_notices n on n.id=j.billing_notice_id where n.subscription_id='${f.sid}';`,
      ),
      '1',
    );
    console.info(
      'PASS: two creators serialize one inbox and one per-device outbox',
    );
  }
  {
    const f = await fixture(db, 'cancel-first');
    const result = await race(
      db,
      'cancel-first',
      cancel(f.sid),
      countCreate(f.sid),
    );
    assert.equal(value(result), '0');
    console.info(
      'PASS: cancellation committed during creator wait prevents stale notice',
    );
  }
  {
    const f = await fixture(db, 'create-first');
    const result = await race(db, 'create-first', create(f.sid), cancel(f.sid));
    value(result);
    assert.equal(
      await db.query(
        `select invalidated_at is not null from private.billing_notices where subscription_id='${f.sid}';`,
      ),
      't',
    );
    assert.equal(
      await db.query(
        `select state from private.notification_jobs j join private.billing_notices n on n.id=j.billing_notice_id where n.subscription_id='${f.sid}';`,
      ),
      'canceled',
    );
    console.info(
      'PASS: later cancellation invalidates committed inbox and pending outbox',
    );
  }
  {
    const f = await fixture(db, 'preference-first');
    const result = await race(
      db,
      'preference-first',
      preference(false),
      create(f.sid),
    );
    const row = JSON.parse(value(result));
    assert.equal(row.created, true);
    assert.equal(row.push_jobs, 0);
    console.info(
      'PASS: billing opt-out serialized before creation blocks push but preserves approved mandatory inbox',
    );
  }
  {
    const f = await fixture(db, 'policy-first');
    const result = await race(
      db,
      'policy-first',
      changePolicy(otherPolicy),
      countCreate(f.sid),
    );
    assert.equal(value(result), '0');
    console.info(
      'PASS: replaced checkout policy suppresses creator after lock wait',
    );
  }
  {
    const f = await fixture(db, 'creator-policy');
    const result = await race(
      db,
      'creator-policy',
      create(f.sid),
      changePolicy(otherPolicy),
    );
    value(result);
    assert.equal(
      await db.query(
        `select private.billing_notice_current(id,clock_timestamp()) from private.billing_notices where subscription_id='${f.sid}';`,
      ),
      'f',
    );
    console.info(
      'PASS: committed notice cannot be read under a newly current unaccepted price policy',
    );
  }
  {
    const f = await fixture(db, 'read-cancel', true);
    const result = await race(
      db,
      'read-cancel',
      cancel(f.sid),
      authenticated(
        fan,
        `select public.billing_notice_mark_read('${f.notice}');`,
      ),
    );
    expectedError(result, 'BILLING_NOTICE_NOT_FOUND');
    assert.equal(
      await db.query(
        `select read_at is null from private.billing_notices where id='${f.notice}';`,
      ),
      't',
    );
    console.info(
      'PASS: owner read waiting on cancellation cannot mark stale notice',
    );
  }
  {
    const f = await fixture(db, 'prepare-cancel', true, true);
    const result = await race(db, 'prepare-cancel', cancel(f.sid), prepare(f));
    assert.equal(value(result), '0');
    console.info(
      'PASS: final send preparation waiting on cancellation returns no endpoint',
    );
  }
  {
    const f = await fixture(db, 'prepare-legal', true, true);
    const doc = uuid();
    await db.query(
      `insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values('${doc}','terms','Fictional replacement','Disposable fixture only.',now(),now());`,
    );
    const result = await race(
      db,
      'prepare-legal',
      `update private.profile_onboarding_policy set terms_version='${doc}';`,
      prepare(f),
    );
    assert.equal(value(result), '0');
    await db.query(
      `update private.profile_onboarding_policy set terms_version='c9000000-0000-4000-8000-000000000001';`,
    );
    console.info(
      'PASS: rotated current legal policy is rechecked after final-send wait',
    );
  }
  {
    const f = await fixture(db, 'prepare-unknown', true, true);
    const uncertain = `select id from public.subscriptions where id='${f.sid}' for update;
      insert into private.billing_obligations(subscription_id,mandate_id,period_start,period_end,amount_krw,is_initial,is_intro,price_version,grace_seconds,retry_seconds,max_retries,next_attempt_at)
      select s.id,m.id,s.current_period_end,s.current_period_end+interval '1 month',7200,false,false,'${policy}',259200,86400,3,now() from public.subscriptions s join private.payment_mandates m on m.subscription_id=s.id where s.id='${f.sid}';
      insert into private.payment_attempts(obligation_id,ordinal,state) select id,1,'unknown' from private.billing_obligations where subscription_id='${f.sid}';`;
    const result = await race(db, 'prepare-unknown', uncertain, prepare(f));
    assert.equal(value(result), '0');
    console.info(
      'PASS: unresolved payment outcome prevents speculative upcoming-charge push',
    );
  }
  {
    const f = await fixture(db, 'prepare-optout', true, true);
    const result = await race(
      db,
      'prepare-optout',
      preference(false),
      prepare(f),
    );
    assert.equal(value(result), '0');
    console.info(
      'PASS: preference change takes effect at exact final send gate',
    );
  }
  {
    const f = await fixture(db, 'accepted-after-optout', true, true);
    const result = await race(
      db,
      'accepted-after-optout',
      prepare(f),
      preference(false),
    );
    assert.equal(result.winner, '1');
    assert.equal(value(result), 'f');
    const accepted = await db.query(
      `begin; ${service(`select public.webpush_complete('${f.job}','${f.token}','provider_accepted','${uuid()}');`)} commit;`,
    );
    assert.equal(accepted, 'provider_accepted');
    assert.equal(
      await db.query(`select count(*) from private.renewal_notice_receipts;`),
      '0',
    );
    console.info(
      'PASS: real acceptance after opt-out remains truthful, never fabricated delivery receipt',
    );
  }
}
try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(`select
    (select count(*) from auth.users)+(select count(*) from public.profiles)+
    (select count(*) from public.subscriptions)+(select count(*) from private.notification_policy)+
    (select count(*) from private.billing_notice_policies)+(select count(*) from private.billing_notices)+
    (select count(*) from private.push_subscriptions)+(select count(*) from private.notification_jobs)+
    (select count(*) from public.artists where id not in('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'));`),
    '0',
    'Use freshly reset disposable local database; this script restores it afterward.',
  );
  shouldReset = true;
  await run(db);
  console.info(
    'All billing notice PostgreSQL independent-session races passed.',
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
