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
    this.label = `settlement-calculation-concurrency-${label}`;
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
    const marker = `SETTLEMENT_CALCULATION_TEST_DONE_${++commandSequence}`;
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

// Selected feature40 tests only. Fixtures are fictional owner-provisioned
// history; refund/report RPCs are real local database boundaries, not providers.
const uuid = () => crypto.randomUUID();
const localCli = fileURLToPath(
  new URL('../node_modules/.bin/supabase', import.meta.url),
);
const actor = (id, sql) =>
  `set local role authenticated; set local "request.jwt.claim.sub"='${id}'; ${sql}`;
const read = (f) =>
  actor(
    f.admin,
    `select public.settlement_calculation_input('${f.artist}','2026-01-01');`,
  );
const refund = (f) =>
  `set local role service_role; select public.billing_record_refund('${f.charge}','fictional-calculation-${uuid()}',500,'KRW','2026-01-15+09','${uuid()}');`;
const execute = (db, sql) => db.query(`begin; ${sql} commit;`);
const page = (result) => JSON.parse(result).input;
const gross = (input) =>
  input.events.reduce((sum, e) => sum + BigInt(e.amountKrw), 0n);
const assertError = (result, expected) =>
  assert.match(result.error?.message ?? '', expected);
let shouldReset = false;

async function fixture(db) {
  const f = {
    admin: uuid(),
    fan: uuid(),
    artist: uuid(),
    subscription: uuid(),
    charge: uuid(),
    message: uuid(),
  };
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values
    ('${f.admin}','calculation-admin-${f.admin}@example.invalid','{}'),('${f.fan}','calculation-fan-${f.fan}@example.invalid','{}');
    update public.profiles set role='admin' where id='${f.admin}';
    insert into public.artists(id,slug,name,grade,status) values('${f.artist}','calculation-${f.artist}','Fictional calculation artist','B','active');
    insert into public.subscriptions(id,user_id,artist_id,provider) values('${f.subscription}','${f.fan}','${f.artist}','toss');
    insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at)
      values('${f.charge}','${f.subscription}','charge',6500,'toss','2026-01-01+09','2026-02-01+09','2026-01-02+09');
    insert into private.payment_event_verifications(event_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
      values('${f.charge}','toss','test','fictional-calculation-merchant','fictional-${f.charge}','${uuid()}');
    insert into private.settlement_policies(artist_id,month,enabled,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate,activity_enabled)
      values('${f.artist}','2026-01-01',true,'2026-01-01','2026-02-01',0.3,0.4,0.1,0.03,false);
    insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
      values('${f.message}','${f.artist}','${f.admin}','photo','Fictional private body','sent','2026-01-05+09','2026-01-05+09');`);
  return f;
}
async function race(db, label, firstSql, secondSql, finalize = 'commit') {
  const first = await session(`${label}-first`);
  const second = await session(`${label}-second`);
  try {
    const winner = await first.query(`begin; ${firstSql}`);
    const following = second.query(`begin; ${secondSql} commit;`).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await waitForBlock(db, second, first);
    await first.query(`${finalize};`);
    return { winner, following: await following };
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
}
async function selectedRaces(db) {
  for (const finalize of ['commit', 'rollback']) {
    const f = await fixture(db);
    const result = await race(
      db,
      `refund-before-${finalize}`,
      refund(f),
      read(f),
      finalize,
    );
    assert.equal(result.following.error, undefined);
    const input = page(result.following.value);
    assert.equal(gross(input), finalize === 'commit' ? 6000n : 6500n);
    assert.equal(input.events.length, finalize === 'commit' ? 2 : 1);
    console.info(
      `PASS: verified refund ${finalize} is observed atomically after source fence wait`,
    );
  }
  {
    const f = await fixture(db);
    const result = await race(db, 'reader-before-refund', read(f), refund(f));
    assert.equal(result.following.error, undefined);
    assert.equal(gross(page(result.winner)), 6500n);
    assert.equal(gross(page(await execute(db, read(f)))), 6000n);
    console.info(
      'PASS: preview excludes subsequent blocked refund; next preview observes it without report mutation',
    );
  }
  for (const finalize of ['commit', 'rollback']) {
    const f = await fixture(db);
    const result = await race(
      db,
      `policy-disable-${finalize}`,
      `update private.settlement_policies set enabled=false where artist_id='${f.artist}';`,
      read(f),
      finalize,
    );
    if (finalize === 'commit')
      assertError(result.following, /SETTLEMENT_POLICY_REQUIRED/);
    else {
      assert.equal(result.following.error, undefined);
      assert.equal(page(result.following.value).policy.enabled, true);
    }
    console.info(
      `PASS: monthly policy ${finalize} is re-read after waiting, not stale-snapshotted`,
    );
  }
  for (const finalize of ['commit', 'rollback']) {
    const f = await fixture(db);
    const result = await race(
      db,
      `admin-revoke-${finalize}`,
      `update public.profiles set role='fan' where id='${f.admin}';`,
      read(f),
      finalize,
    );
    if (finalize === 'commit')
      assertError(result.following, /SETTLEMENT_ADMIN_REQUIRED/);
    else {
      assert.equal(result.following.error, undefined);
      assert.equal(JSON.parse(result.following.value).actorId, f.admin);
    }
    console.info(
      `PASS: administrator revocation ${finalize} is checked after authority lock wait`,
    );
  }
  {
    const f = await fixture(db);
    const result = await race(
      db,
      'reader-before-revoke',
      read(f),
      `update public.profiles set is_restricted=true where id='${f.admin}';`,
    );
    assert.equal(result.following.error, undefined);
    assert.equal(JSON.parse(result.winner).actorId, f.admin);
    await expectReaderError(read(f), /SETTLEMENT_ADMIN_REQUIRED/);
    console.info(
      'PASS: authorized preview holds profile lock; later restriction blocks the next request',
    );
  }
}
// Expected-error sessions must never terminate the shared fixture observer.
async function expectReaderError(sql, pattern) {
  const client = await session(`expected-error-${uuid()}`);
  try {
    const result = await client.query(`begin; ${sql} commit;`).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    assertError(result, pattern);
  } finally {
    await client.close();
  }
}
async function lockOrderRaces(db) {
  {
    const f = await fixture(db),
      writer = await session('source-row-first'),
      reader = await session('source-row-reader');
    try {
      await writer.query(
        `begin; select id from public.messages where id='${f.message}' for update;`,
      );
      const result = page(await reader.query(`begin; ${read(f)}`));
      assert.equal(result.messages.length, 1);
      const following = writer.query(
        `update public.messages set status='canceled',body=null,canceled_at='2026-01-05 00:01+09' where id='${f.message}'; commit;`,
      );
      await waitForBlock(db, writer, reader);
      await reader.query('commit;');
      await following;
      assert.equal(page(await execute(db, read(f))).messages.length, 0);
      console.info(
        'PASS: source-row lock before fence has no row/advisory inversion; canceled message is absent next read',
      );
    } finally {
      await Promise.all([writer.close(), reader.close()]);
    }
  }
  {
    const f = await fixture(db),
      writer = await session('artist-row-first');
    try {
      await writer.query(
        `begin; select id from public.artists where id='${f.artist}' for update;`,
      );
      await expectReaderError(read(f), /SETTLEMENT_SOURCE_BUSY/);
      await writer.query('rollback;');
      assert.equal(gross(page(await execute(db, read(f)))), 6500n);
      console.info(
        'PASS: artist row inversion returns SOURCE_BUSY without waiting or deadlocking',
      );
    } finally {
      await writer.close();
    }
  }
  {
    const f = await fixture(db);
    const report = await execute(
      db,
      actor(
        f.admin,
        `select public.settlement_calculate('${f.artist}','2026-01-01');`,
      ),
    );
    const revision = await db.query(
      `select revision from public.settlements where id='${report}';`,
    );
    const result = await race(
      db,
      'confirmed-before-reader',
      actor(
        f.admin,
        `select public.settlement_confirm('${report}','${revision}');`,
      ),
      read(f),
    );
    assertError(result.following, /SETTLEMENT_CONFIRMED/);
    console.info(
      'PASS: committed confirmation cannot be bypassed by pre-wait preview snapshot',
    );
  }
}
try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(
      `select (select count(*) from auth.users)+(select count(*) from public.payment_events)+(select count(*) from private.settlement_policies)+(select count(*) from public.settlements)+(select count(*) from private.point_ledger)+(select count(*) from storage.objects);`,
    ),
    '0',
    'Use freshly reset disposable local database only.',
  );
  shouldReset = true;
  await selectedRaces(db);
  await lockOrderRaces(db);
  assert.equal(
    await db.query(
      `select count(*) from public.settlements where status='draft';`,
    ),
    '0',
    'preview never creates draft reports',
  );
  console.info(
    'All eleven selected PostgreSQL settlement-calculation races passed.',
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
        'Settlement calculation fixtures require disposable local reset before reuse.',
        error,
      );
      process.exitCode = 1;
    }
}
