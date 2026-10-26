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
    this.label = `settlement-report-concurrency-${label}`;
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
    const marker = `SETTLEMENT_REPORT_TEST_DONE_${++commandSequence}`;
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
    // application_name is truncated by PostgreSQL at NAMEDATALEN-1 bytes.
    // Labels remain diagnostics only; real backend PIDs identify lock owners.
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
    const result = await observer.query(`
      select exists (
        select 1 from pg_stat_activity waiting, pg_stat_activity blocking
        where waiting.pid = ${waiting.pid}
          and blocking.pid = ${blocking.pid}
          and waiting.wait_event_type = 'Lock'
          and blocking.pid = any(pg_blocking_pids(waiting.pid))
      );
    `);
    if (result === 't') return;
    await delay(25);
  }
  throw new Error(`${waiting.label} never blocked on ${blocking.label}`);
}

// Only new feature41 report-workflow races. No prior suite or remote database.
const uuid = () => crypto.randomUUID();
const localCli = fileURLToPath(
  new URL('../node_modules/.bin/supabase', import.meta.url),
);
const actor = (id, sql) =>
  `set local role authenticated; set local "request.jwt.claim.sub"='${id}'; ${sql}`;
const read = (f, who = f.admin) =>
  actor(
    who,
    `select public.settlement_report_read('${f.artist}','2026-01-01');`,
  );
const calculate = (f, revision = null) =>
  actor(
    f.admin,
    `select public.settlement_report_calculate('${f.artist}','2026-01-01',${revision ? `'${revision}'` : 'null'});`,
  );
const exportReport = (f, report) =>
  actor(
    f.admin,
    `select public.settlement_report_export('${report.id}','${report.revision}');`,
  );
const confirm = (f, report) =>
  actor(
    f.admin,
    `select public.settlement_report_confirm('${report.id}','${report.revision}');`,
  );
const execute = (db, sql) => db.query(`begin; ${sql} commit;`);
const report = (result) => JSON.parse(result).report;
const assertError = (result, expected) =>
  assert.match(result.error?.message ?? '', expected);
let shouldReset = false;
async function fixture(db) {
  const f = {
    admin: uuid(),
    fan: uuid(),
    member: uuid(),
    artist: uuid(),
    subscription: uuid(),
    charge: uuid(),
    terms: uuid(),
    privacy: uuid(),
  };
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values
    ('${f.admin}','report-admin-${f.admin}@example.invalid','{}'),('${f.fan}','report-fan-${f.fan}@example.invalid','{}'),
    ('${f.member}','report-member-${f.member}@example.invalid','{}');
    update public.profiles set role='admin' where id='${f.admin}';
    update public.profiles set role='artist',call_name='가수',onboarding_completed_at=clock_timestamp() where id='${f.member}';
    insert into public.artists(id,slug,name,grade,status) values('${f.artist}','report-${f.artist}','Fictional report artist','B','active');
    insert into public.artist_members(artist_id,user_id) values('${f.artist}','${f.member}');
    insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
      ('${f.terms}','terms','Fictional terms','Test only',now()-interval '2 day',now()-interval '1 day'),
      ('${f.privacy}','privacy','Fictional privacy','Test only',now()-interval '2 day',now()-interval '1 day');
    insert into private.profile_onboarding_policy(singleton,name_policy_version,name_approved_at,call_name_min,call_name_max,profanity_words,terms_version,privacy_version)
      values(true,'${uuid()}',now()-interval '1 day',2,10,array['fictionalblocked'],'${f.terms}','${f.privacy}')
      on conflict(singleton) do update set terms_version=excluded.terms_version,privacy_version=excluded.privacy_version;
    insert into private.profile_policy_acceptances(user_id,kind,version,accepted_at) values
      ('${f.member}','terms','${f.terms}',now()),('${f.member}','privacy','${f.privacy}',now());
    insert into public.subscriptions(id,user_id,artist_id,provider) values('${f.subscription}','${f.fan}','${f.artist}','toss');
    insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at)
      values('${f.charge}','${f.subscription}','charge',11000,'toss','2026-01-01+09','2026-02-01+09','2026-01-02+09');
    insert into private.payment_event_verifications(event_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
      values('${f.charge}','toss','test','fictional-report-merchant','fictional-${f.charge}','${uuid()}');
    insert into private.settlement_policies(artist_id,month,enabled,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate,activity_enabled)
      values('${f.artist}','2026-01-01',true,'2026-01-01','2026-02-01',0.3,0.4,0.1,0.03,false);`);
  return f;
}
async function race(db, label, firstSql, secondSql, finalize = 'commit') {
  const first = await session(`${label}-first`),
    second = await session(`${label}-second`);
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
async function expectError(sql, pattern) {
  const client = await session(`error-${uuid()}`);
  try {
    assertError(
      await client.query(`begin; ${sql} commit;`).then(
        (value) => ({ value }),
        (error) => ({ error }),
      ),
      pattern,
    );
  } finally {
    await client.close();
  }
}
async function selectedRaces(db) {
  {
    const f = await fixture(db);
    const result = await race(db, 'create-cas', calculate(f), calculate(f));
    assert.equal(report(result.winner).status, 'draft');
    assertError(result.following, /SETTLEMENT_REVISION_CONFLICT/);
    assert.equal(
      await db.query(
        `select count(*) from public.settlements where artist_id='${f.artist}';`,
      ),
      '1',
    );
    console.info(
      'PASS: concurrent create cannot silently overwrite the first draft',
    );
  }
  for (const finalize of ['commit', 'rollback']) {
    const f = await fixture(db),
      original = report(await execute(db, calculate(f)));
    await execute(
      db,
      `set local role service_role; select public.billing_record_refund('${f.charge}','fictional-report-${uuid()}',1000,'KRW','2026-01-15+09','${uuid()}');`,
    );
    const result = await race(
      db,
      `recalculate-export-${finalize}`,
      calculate(f, original.revision),
      exportReport(f, original),
      finalize,
    );
    if (finalize === 'commit')
      assertError(result.following, /SETTLEMENT_REVISION_CONFLICT/);
    else {
      assert.equal(result.following.error, undefined);
      const data = JSON.parse(result.following.value);
      assert.equal(data.report.revision, original.revision);
      assert.equal(data.report.grossKrw, '11000');
      assert.equal(data.sources.length, 1);
      assert.equal(data.sources[0].amountKrw, '11000');
    }
    console.info(
      `PASS: export waits for recalculation ${finalize} and never mixes revision or source sheets`,
    );
  }
  {
    const f = await fixture(db),
      draft = report(await execute(db, calculate(f)));
    const result = await race(
      db,
      'confirm-idempotent',
      confirm(f, draft),
      confirm(f, draft),
    );
    assert.equal(result.following.error, undefined);
    assert.deepEqual(report(result.following.value), report(result.winner));
    assert.equal(report(result.winner).status, 'confirmed');
    console.info('PASS: concurrent same-revision confirmation is idempotent');
  }
  {
    const f = await fixture(db);
    await execute(db, calculate(f));
    const result = await race(
      db,
      'admin-revoke',
      `update public.profiles set role='fan' where id='${f.admin}';`,
      read(f),
    );
    assertError(result.following, /SETTLEMENT_FORBIDDEN/);
    console.info(
      'PASS: report reader observes committed administrator revocation after profile wait',
    );
  }
  for (const kind of ['consent', 'membership']) {
    const f = await fixture(db),
      draft = report(await execute(db, calculate(f)));
    await execute(db, confirm(f, draft));
    const mutation =
      kind === 'consent'
        ? `delete from private.profile_policy_acceptances where user_id='${f.member}' and kind='privacy';`
        : `delete from public.artist_members where artist_id='${f.artist}' and user_id='${f.member}';`;
    const result = await race(
      db,
      `artist-${kind}-revoke`,
      mutation,
      read(f, f.member),
    );
    assertError(
      result.following,
      kind === 'consent'
        ? /SETTLEMENT_CONSENT_REQUIRED/
        : /SETTLEMENT_FORBIDDEN/,
    );
    console.info(
      `PASS: confirmed report reader observes committed artist ${kind} removal after wait`,
    );
  }
  {
    const f = await fixture(db),
      draft = report(await execute(db, calculate(f)));
    await execute(db, confirm(f, draft));
    const result = await race(
      db,
      'reader-before-consent',
      read(f, f.member),
      `delete from private.profile_policy_acceptances where user_id='${f.member}' and kind='privacy';`,
    );
    assert.equal(result.following.error, undefined);
    assert.equal(report(result.winner).status, 'confirmed');
    await expectError(read(f, f.member), /SETTLEMENT_CONSENT_REQUIRED/);
    console.info(
      'PASS: authorized reader holds exact consent evidence; withdrawal applies to next read',
    );
  }
  {
    const f = await fixture(db),
      writer = await session('artist-row-first');
    try {
      await writer.query(
        `begin; select id from public.artists where id='${f.artist}' for update;`,
      );
      await expectError(read(f), /SETTLEMENT_SOURCE_BUSY/);
      await writer.query('rollback;');
      assert.equal(report(await execute(db, read(f))), null);
      console.info('PASS: artist row inversion fails NOWAIT without deadlock');
    } finally {
      await writer.close();
    }
  }
  {
    const f = await fixture(db),
      result = await race(db, 'calculate-before-read', calculate(f), read(f));
    assert.equal(result.following.error, undefined);
    assert.deepEqual(report(result.following.value), report(result.winner));
    console.info(
      'PASS: reader after blocked create returns the same complete committed report',
    );
  }
}
try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(
      `select (select count(*) from auth.users)+(select count(*) from public.payment_events)+(select count(*) from private.settlement_policies)+(select count(*) from public.settlements)+(select count(*) from private.profile_onboarding_policy)+(select count(*) from storage.objects);`,
    ),
    '0',
    'Use freshly reset disposable local database only.',
  );
  shouldReset = true;
  await selectedRaces(db);
  console.info('All ten selected PostgreSQL settlement-report races passed.');
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
        'Settlement report fixtures require disposable local reset before reuse.',
        error,
      );
      process.exitCode = 1;
    }
}
