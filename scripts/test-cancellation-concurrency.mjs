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
    this.label = `cancellation-concurrency-${label}`;
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
    const marker = `CANCELLATION_TEST_DONE_${++commandSequence}`;
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
    const backendPid = await this.query(`
      set application_name = '${this.label}';
      set statement_timeout = '${timeoutMs}ms';
      set lock_timeout = '${timeoutMs}ms';
      set timezone = 'UTC';
      select pg_backend_pid();
    `);
    // application_name is shorter than NAMEDATALEN (at most 63 bytes normally),
    // so long descriptive race labels are not reliable session identities.
    // Observe the actual live connection by its database-assigned backend PID.
    assert.match(
      backendPid,
      /^[1-9][0-9]*$/,
      'Expected one real PostgreSQL backend PID.',
    );
    this.backendPid = Number(backendPid);
    assert.ok(
      Number.isSafeInteger(this.backendPid),
      'Expected a safe backend PID.',
    );
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
        where waiting.pid = ${waiting.backendPid}
          and blocking.pid = ${blocking.backendPid}
          and waiting.wait_event_type = 'Lock'
          and blocking.pid = any(pg_blocking_pids(waiting.pid))
      );
    `);
    if (result === 't') return;
    await delay(25);
  }
  throw new Error(`${waiting.label} never blocked on ${blocking.label}`);
}

// Only fictional local identity/content rows; no provider calls or stored blobs.
const uuid = () => crypto.randomUUID();
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
const actor = (id, sql) =>
  `set local role authenticated; select set_config('request.jwt.claims','{"sub":"${id}","role":"authenticated"}',true); ${sql}`;
let checks = 0;
const pass = (label) => {
  checks += 1;
  console.info(`PASS: ${label}`);
};
async function call(db, role, expression) {
  const output = await db.query(
    `begin; ${role(`select ${expression};`)} commit;`,
  );
  return JSON.parse(output.split('\n').at(-1));
}
async function setup(db) {
  const f = {
    fan: uuid(),
    admin: uuid(),
    admin2: uuid(),
    checkout: uuid(),
    policy: uuid(),
  };
  await db.query(`
 insert into auth.users(id,email,raw_user_meta_data) values
 ('${f.fan}','cancel-race-fan@example.invalid','{}'),('${f.admin}','cancel-race-admin@example.invalid','{}'),('${f.admin2}','cancel-race-admin-two@example.invalid','{}');
 update public.profiles set role='admin' where id in ('${f.admin}','${f.admin2}');
 insert into private.checkout_policies values('${f.checkout}','Fictional checkout','Disposable race only',1000,1000,now(),now(),'utc_monthly_clamped','taxable_krw');
 insert into private.refund_policies values('${f.policy}','Fictional refund policy','Disposable race only: review and retained paid access.','preserve_paid_access','taxable_krw',now(),now());
 insert into private.refund_policy_current values(true,'${f.policy}');`);
  return f;
}
async function fixture(db, f) {
  const c = {
    ...f,
    sid: uuid(),
    artist: uuid(),
    mid: uuid(),
    obligation: uuid(),
    attempt: uuid(),
    charge: uuid(),
    request: uuid(),
  };
  await db.query(`
 insert into public.artists(id,slug,name,grade,status) values('${c.artist}','cancel-${c.artist}','Fictional race artist','B','active');
 insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end,next_billing_at)
 values('${c.sid}','${f.fan}','${c.artist}','toss','active',now()-interval '2 days',now()-interval '2 days',now()-interval '2 days',now()+interval '28 days',now()+interval '28 days');
 insert into private.payment_mandates(id,subscription_id,provider,environment,merchant_account,provider_customer_ref,secure_credential_ref,consent_version)
 values('${c.mid}','${c.sid}','toss','test','cancellation-fixture','${uuid()}','${uuid()}','${f.checkout}');
 insert into private.billing_obligations(id,subscription_id,mandate_id,period_start,period_end,amount_krw,is_initial,is_intro,price_version,grace_seconds,retry_seconds,max_retries,state,next_attempt_at)
 values('${c.obligation}','${c.sid}','${c.mid}',now()-interval '2 days',now()+interval '28 days',1000,true,false,'${f.checkout}',0,1,0,'settled',now());
 insert into private.payment_attempts(id,obligation_id,ordinal,state) values('${c.attempt}','${c.obligation}',1,'success');
 insert into private.renewal_attempts(attempt_id,provider_payment_id) values('${c.attempt}','PAYMENT_${c.attempt}');
 insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at)
 values('${c.charge}','${c.sid}','charge',1000,'toss',now()-interval '2 days',now()+interval '28 days',now()-interval '2 days');
 insert into private.payment_event_verifications(event_id,attempt_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
 values('${c.charge}','${c.attempt}','toss','test','cancellation-fixture','CHARGE_${c.attempt}','${uuid()}');`);
  return c;
}
const requestSql = (c, key = uuid()) =>
  `select public.refund_request('${c.sid}','${c.charge}',600,'Fictional review','${key}');`;
const approvalSql = (c) =>
  `select public.refund_decide('${c.request}','approve',600,'${c.policy}','Fictional authorization');`;
const claimSql = (c, admin = c.admin) =>
  `select public.refund_claim('${c.request}','${admin}',120);`;
async function requested(db, c) {
  const data = await call(
    db,
    (sql) => actor(c.fan, sql),
    `public.refund_request('${c.sid}','${c.charge}',600,'Fictional review','${uuid()}')`,
  );
  c.request = data.id;
  return c;
}
async function authorized(db, c) {
  await requested(db, c);
  await db.query(`begin; ${actor(c.admin, approvalSql(c))} commit;`);
  return c;
}
function parsed(result) {
  return JSON.parse(result.split('\n').at(-1));
}
async function tests(db) {
  const f = await setup(db);
  {
    const c = await fixture(db, f),
      key = uuid();
    const result = await race(
      db,
      'request-dedup',
      actor(f.fan, requestSql(c, key)),
      actor(f.fan, requestSql(c, key)),
    );
    assert.equal(parsed(result.winner).id, parsed(result.following.value).id);
    assert.equal(
      await db.query(
        `select count(*) from private.refund_requests where original_event_id='${c.charge}';`,
      ),
      '1',
    );
    pass(
      'concurrent same-key owner requests serialize into one review request',
    );
  }
  {
    const c = await requested(db, await fixture(db, f));
    const result = await race(
      db,
      'approve-once',
      actor(f.admin, approvalSql(c)),
      actor(f.admin, approvalSql(c)),
    );
    assert.equal(parsed(result.winner).status, 'authorized');
    assert.equal(parsed(result.following.value).status, 'authorized');
    assert.equal(
      await db.query(
        `select count(*) from private.refund_decisions where request_id='${c.request}';`,
      ),
      '1',
    );
    pass('concurrent identical authorizations preserve one immutable decision');
  }
  {
    const c = await authorized(db, await fixture(db, f));
    const result = await race(
      db,
      'claim-once',
      service(claimSql(c)),
      service(claimSql(c)),
    );
    assert.equal(parsed(result.winner).dispatch, true);
    assert.equal(parsed(result.following.value).dispatch, false);
    pass(
      'concurrent execution claims grant exactly one provider refund dispatch',
    );
  }
  {
    const c = await authorized(db, await fixture(db, f));
    const result = await race(
      db,
      'withdraw-before-dispatch',
      actor(
        f.admin,
        `select public.refund_decide('${c.request}','reject',null,null,'Withdraw approval');`,
      ),
      service(claimSql(c)),
    );
    assert.equal(parsed(result.following.value).dispatch, false);
    assert.equal(parsed(result.following.value).state, 'rejected');
    pass('authorization withdrawal winning the lock prevents dispatch');
  }
  {
    const c = await authorized(db, await fixture(db, f));
    const result = await race(
      db,
      'dispatch-before-withdraw',
      service(claimSql(c)),
      actor(
        f.admin,
        `select public.refund_decide('${c.request}','reject',null,null,'Too late to withdraw');`,
      ),
    );
    assert.equal(parsed(result.winner).dispatch, true);
    assert.match(result.following.error.message, /REFUND_STATE_CONFLICT/);
    pass(
      'dispatch winning the lock prevents false rejected state after provider boundary',
    );
  }
  {
    const c = await authorized(db, await fixture(db, f));
    const result = await race(
      db,
      'approver-revoked',
      `update public.profiles set role='fan' where id='${f.admin}';`,
      service(claimSql(c, f.admin2)),
    );
    assert.equal(parsed(result.following.value).dispatch, false);
    assert.equal(
      parsed(result.following.value).reason,
      'AUTHORIZATION_REVOKED',
    );
    await db.query(
      `update public.profiles set role='admin' where id='${f.admin}';`,
    );
    pass(
      'approving admin role revocation serializes before a new refund dispatch',
    );
  }
  {
    const c = await authorized(db, await fixture(db, f));
    const result = await race(
      db,
      'executor-revoked',
      `update public.profiles set role='fan' where id='${f.admin2}';`,
      service(claimSql(c, f.admin2)),
    );
    assert.match(result.following.error.message, /FORBIDDEN/);
    await db.query(
      `update public.profiles set role='admin' where id='${f.admin2}';`,
    );
    pass('executing admin role revocation independently serializes with claim');
  }
  {
    const c = await authorized(db, await fixture(db, f));
    await db.query(`begin; ${service(claimSql(c))} commit;`);
    const at = await db.query(`select date_trunc('second',clock_timestamp());`);
    const finalize = `select public.refund_finalize('${c.request}','ACTION_${c.request}','PAYMENT_${c.attempt}',600,'KRW','${at}','${uuid()}');`;
    const result = await race(
      db,
      'finalize-dedup',
      service(finalize),
      service(finalize),
    );
    assert.equal(result.winner, result.following.value);
    assert.equal(
      await db.query(
        `select count(*) from public.payment_events where original_event_id='${c.charge}';`,
      ),
      '1',
    );
    pass(
      'lost finalization response replay recognizes one immutable refund ledger entry',
    );
  }
  {
    const c = await authorized(db, await fixture(db, f));
    const at = await db.query(`select date_trunc('second',clock_timestamp());`);
    const external = `select public.billing_record_refund('${c.charge}','EXTERNAL_${c.request}',500,'KRW','${at}','${uuid()}');`;
    const result = await race(
      db,
      'capacity-before-dispatch',
      service(external),
      service(claimSql(c)),
    );
    assert.equal(parsed(result.following.value).dispatch, false);
    assert.equal(parsed(result.following.value).reason, 'LEDGER_CHANGED');
    pass(
      'verified external refund winning original-charge lock invalidates stale authorization capacity',
    );
  }
  {
    const c = await authorized(db, await fixture(db, f));
    const claim = await call(
      db,
      service,
      `public.refund_claim('${c.request}','${f.admin}',120)`,
    );
    await db.query(`begin; ${service(`select public.refund_record_outcome('${c.request}','${claim.lease_token}','unknown');`)} commit;
 update private.refund_requests set next_query_at=clock_timestamp()-interval '1 second' where id='${c.request}';`);
    const result = await race(
      db,
      'query-once',
      service(claimSql(c)),
      service(claimSql(c)),
    );
    assert.equal(parsed(result.winner).action, 'reconcile');
    assert.equal(parsed(result.winner).dispatch, true);
    assert.equal(parsed(result.following.value).dispatch, false);
    assert.equal(
      await db.query(
        `select state from private.refund_requests where id='${c.request}';`,
      ),
      'unknown',
    );
    pass(
      'unknown operations serialize query leases and never regain monetary dispatch',
    );
  }
  // Real legacy renewal claim primitive used by renewal_claim: cancellations
  // share the subscription lock. The paid interval is kept unchanged.
  for (const cancellationFirst of [true, false]) {
    const c = await fixture(db, f),
      obligation = uuid(),
      attempt = uuid();
    await db.query(`insert into private.billing_obligations(id,subscription_id,mandate_id,period_start,period_end,amount_krw,is_initial,is_intro,price_version,grace_seconds,retry_seconds,max_retries,next_attempt_at)
 select '${obligation}',id,'${c.mid}',current_period_end,current_period_end+interval '1 month',1000,false,false,'${f.checkout}',259200,86400,3,now()-interval '1 second' from public.subscriptions where id='${c.sid}';
 insert into private.payment_attempts(id,obligation_id,ordinal) values('${attempt}','${obligation}',1);`);
    const cancel = actor(
        f.fan,
        `select (public.cancel_subscription('${c.sid}')).status;`,
      ),
      charge = service(
        `select public.billing_claim_attempt('${attempt}',120);`,
      );
    const result = await race(
      db,
      `cancel-renewal-${cancellationFirst}`,
      cancellationFirst ? cancel : charge,
      cancellationFirst ? charge : cancel,
    );
    if (cancellationFirst) assert.equal(result.following.value, '');
    else assert.ok(parsed(result.winner).lease_token);
    assert.equal(
      await db.query(
        `select status||':'||(next_billing_at is null)::text||':'||(current_period_end>now())::text from public.subscriptions where id='${c.sid}';`,
      ),
      'canceled:true:true',
    );
    assert.equal(
      await db.query(
        `select state from private.billing_obligations where id='${obligation}';`,
      ),
      cancellationFirst ? 'void' : 'open',
    );
    pass(
      cancellationFirst
        ? 'cancellation winning renewal race stops avoidable dispatch and preserves paid access'
        : 'already claimed renewal stays reconcilable after cancellation without reopening billing',
    );
  }
}
try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(
      `select (select count(*) from auth.users)+(select count(*) from public.subscriptions)+(select count(*) from private.refund_requests)+(select count(*) from private.refund_policies);`,
    ),
    '0',
    'Use a freshly reset disposable local database only.',
  );
  shouldReset = true;
  await tests(db);
  assert.equal(checks, 12);
  console.info(
    `All ${checks} PostgreSQL multi-session cancellation/refund concurrency checks passed.`,
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
        'Local fixture cleanup failed. Run npm run db:reset before reuse.',
        error,
      );
      process.exitCode = 1;
    }
}
