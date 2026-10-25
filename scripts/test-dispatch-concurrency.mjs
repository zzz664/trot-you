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
    this.label = `dispatch-concurrency-${label}`;
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
    const marker = `DISPATCH_TEST_DONE_${++commandSequence}`;
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

// Only fictional local identity/content rows; no provider calls or stored blobs.
const uuid = () => crypto.randomUUID();
const service = (sql) => `set local role service_role; ${sql}`;
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

async function fixture(db) {
  const authorId = uuid(),
    artistId = uuid(),
    fanId = uuid();
  const slug = `dispatch-race-${artistId}`;
  await db.query(`
    insert into auth.users(id,email,raw_user_meta_data) values
      ('${authorId}','dispatch-author@example.invalid','{}'),('${fanId}','dispatch-fan@example.invalid','{}');
    update public.profiles set role='artist' where id='${authorId}';
    update public.profiles set call_name='가상 팬',onboarding_completed_at=now() where id='${fanId}';
    insert into public.artists(id,slug,name,grade,status) values('${artistId}','${slug}','허구 발행 경합 가수','B','active');
    insert into public.artist_members(artist_id,user_id) values('${artistId}','${authorId}');
    insert into private.profile_onboarding_policy values(true,'${uuid()}',now(),2,10,array['금지단어'],null,null,null);
    insert into private.message_policy values(true,'fictional-dispatch-race',604800,300,1000,100,2,180,60,5,1000,2000,3000);
    insert into private.notification_policy values(true,'fictional-dispatch-race','fictional-consent',true,2,10,30,86400);
    insert into public.subscriptions(user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end)
      values('${fanId}','${artistId}','toss','active',now()-interval '1 day',now()-interval '1 day',now()-interval '1 day',now()+interval '1 day');
    insert into private.notification_preferences(user_id,webpush_enabled,new_message,billing,schedule) values('${fanId}',true,true,false,false);
    insert into private.push_subscriptions(user_id,endpoint,p256dh,auth,consent_version)
      values('${fanId}','https://push.example.invalid/${fanId}',repeat('B',87),repeat('A',22),'fictional-consent');
  `);
  return { authorId, artistId, fanId, slug };
}
const execute = (db, sql) => db.query(`begin; ${sql} commit;`);
function submit(f, id, operation = uuid(), revision = 1, time = 'null') {
  return authenticated(
    f.authorId,
    `select public.artist_dispatch_submit('${f.slug}','${id}','${operation}',${revision},${time});`,
  );
}
function cancel(f, id, operation = uuid()) {
  return authenticated(
    f.authorId,
    `select public.artist_dispatch_cancel('${f.slug}','${id}','${operation}');`,
  );
}
async function draft(db, f) {
  const id = uuid();
  await execute(
    db,
    authenticated(
      f.authorId,
      `select public.artist_compose_save('${f.slug}','${id}','${uuid()}',0,'text','허구 발행 {이름}');`,
    ),
  );
  return id;
}
async function due(db, f) {
  const id = await draft(db, f);
  await execute(
    db,
    submit(f, id, uuid(), 1, "clock_timestamp()+interval '1 day'"),
  );
  await db.query(`update public.messages set scheduled_at=clock_timestamp()-interval '1 second' where id='${id}';
    update private.artist_dispatch_submissions set next_attempt_at=clock_timestamp()-interval '1 second' where message_id='${id}';`);
  return id;
}
function expectError(result, code) {
  assert.ok(result.following.error, `expected ${code}`);
  assert.match(String(result.following.error), new RegExp(code));
  assert.doesNotMatch(
    String(result.following.error),
    /deadlock detected|lock timeout|statement timeout/,
  );
}
function expectSuccess(result) {
  assert.equal(result.following.error, undefined);
  return result.following.value;
}
async function skippedWorker(db, label, firstSql, rollback = false) {
  const first = await session(`${label}-first`),
    second = await session(`${label}-second`);
  try {
    const winner = await first.query(`begin; ${firstSql}`);
    const following = JSON.parse(
      await second.query(
        `begin; ${service('select public.message_dispatch_run(1);')} commit;`,
      ),
    );
    assert.equal(following.published, 0);
    assert.equal(following.skipped, 1);
    await first.query(rollback ? 'rollback;' : 'commit;');
    return { winner, following };
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
}
async function assertEffects(db, id, state, jobs) {
  assert.equal(
    await db.query(`select status from public.messages where id='${id}';`),
    state,
  );
  assert.equal(
    await db.query(
      `select count(*) from private.notification_jobs where source_id='${id}';`,
    ),
    String(jobs),
  );
}
async function testConcurrency(db) {
  const f = await fixture(db);
  const firstId = await draft(db, f),
    operation = uuid();
  const duplicate = await race(
    db,
    'duplicate-confirm',
    submit(f, firstId, operation),
    submit(f, firstId, operation),
  );
  assert.deepEqual(
    JSON.parse(expectSuccess(duplicate)),
    JSON.parse(duplicate.winner),
  );
  await assertEffects(db, firstId, 'sent', 1);
  console.info(
    'PASS: double-click/lost response produces one source and one per-device outbox job',
  );

  const changed = await race(
    db,
    'changed-key',
    submit(f, firstId, operation),
    submit(f, firstId, operation, 2),
  );
  expectError(changed, 'DISPATCH_OPERATION_CONFLICT');
  console.info('PASS: concurrent reused operation cannot change its request');

  const editId = await draft(db, f);
  const edit = await race(
    db,
    'edit-before-confirm',
    authenticated(
      f.authorId,
      `select public.artist_compose_save('${f.slug}','${editId}','${uuid()}',1,'text','더 새로운 내용');`,
    ),
    submit(f, editId),
  );
  expectError(edit, 'DISPATCH_REVISION_CONFLICT');
  await assertEffects(db, editId, 'draft', 0);
  console.info(
    'PASS: competing draft edit wins before stale dispatch confirmation',
  );

  const confirmId = await draft(db, f);
  const confirm = await race(
    db,
    'confirm-before-edit',
    submit(f, confirmId),
    authenticated(
      f.authorId,
      `select public.artist_compose_save('${f.slug}','${confirmId}','${uuid()}',1,'text','늦은 덮어쓰기');`,
    ),
  );
  expectError(confirm, 'COMPOSE_NOT_DRAFT');
  await assertEffects(db, confirmId, 'sent', 1);
  console.info('PASS: confirmation wins before late editor overwrite');

  const cancelOperation = uuid();
  const cancelReplay = await race(
    db,
    'duplicate-cancel',
    cancel(f, confirmId, cancelOperation),
    cancel(f, confirmId, cancelOperation),
  );
  assert.deepEqual(
    JSON.parse(expectSuccess(cancelReplay)),
    JSON.parse(cancelReplay.winner),
  );
  assert.equal(
    await db.query(
      `select state from private.notification_jobs where source_id='${confirmId}';`,
    ),
    'canceled',
  );
  console.info(
    'PASS: duplicate cancellation is idempotent and cancels pending outbox',
  );

  const canceledDue = await due(db, f);
  await skippedWorker(db, 'cancel-before-worker', cancel(f, canceledDue));
  await assertEffects(db, canceledDue, 'canceled', 0);
  console.info(
    'PASS: uncommitted cancellation blocks worker without provider/outbox effects',
  );

  const workerDue = await due(db, f);
  const workerThenCancel = await race(
    db,
    'worker-before-cancel',
    service('select public.message_dispatch_run(1);'),
    cancel(f, workerDue),
  );
  assert.equal(JSON.parse(workerThenCancel.winner).published, 1);
  assert.equal(JSON.parse(expectSuccess(workerThenCancel)).status, 'canceled');
  await assertEffects(db, workerDue, 'canceled', 1);
  assert.equal(
    await db.query(
      `select state from private.notification_jobs where source_id='${workerDue}';`,
    ),
    'canceled',
  );
  console.info(
    'PASS: published worker winner is atomically canceled by waiting owner',
  );

  const competingDue = await due(db, f);
  await skippedWorker(
    db,
    'two-workers',
    service('select public.message_dispatch_run(1);'),
  );
  await assertEffects(db, competingDue, 'sent', 1);
  console.info('PASS: overlapping workers never both claim a publication');

  const crashDue = await due(db, f);
  await skippedWorker(
    db,
    'worker-crash',
    service('select public.message_dispatch_run(1);'),
    true,
  );
  await assertEffects(db, crashDue, 'scheduled', 0);
  await db.query(
    `update private.artist_dispatch_submissions set next_attempt_at=clock_timestamp()-interval '1 second' where message_id='${crashDue}';`,
  );
  assert.equal(
    JSON.parse(
      await execute(db, service('select public.message_dispatch_run(1);')),
    ).published,
    1,
  );
  await assertEffects(db, crashDue, 'sent', 1);
  console.info(
    'PASS: crashed uncommitted worker leaves recoverable scheduled source and zero partial jobs',
  );

  const restrictedId = await draft(db, f);
  const restricted = await race(
    db,
    'restriction-before-submit',
    `update public.profiles set is_restricted=true where id='${f.authorId}';`,
    submit(f, restrictedId),
  );
  expectError(restricted, 'COMPOSE_FORBIDDEN');
  await db.query(
    `update public.profiles set is_restricted=false where id='${f.authorId}';`,
  );
  console.info('PASS: winning restriction blocks a waiting confirmation');

  const membership = await race(
    db,
    'membership-before-submit',
    `delete from public.artist_members where artist_id='${f.artistId}' and user_id='${f.authorId}';`,
    submit(f, restrictedId),
  );
  expectError(membership, 'COMPOSE_FORBIDDEN');
  await db.query(
    `insert into public.artist_members(artist_id,user_id) values('${f.artistId}','${f.authorId}');`,
  );
  console.info('PASS: removed membership blocks waiting dispatch authority');

  const expireId = await draft(db, f);
  await execute(db, submit(f, expireId));
  const expiry = await race(
    db,
    'cancel-deadline-during-wait',
    `select 1 from public.profiles where id='${f.authorId}' for update;
    update public.messages set scheduled_at=clock_timestamp()-interval '299.8 seconds',sent_at=clock_timestamp()-interval '299.8 seconds' where id='${expireId}';`,
    cancel(f, expireId),
    async () => {
      await db.query('select pg_sleep(0.3);');
    },
  );
  expectError(expiry, 'CANCEL_WINDOW_PASSED');
  console.info(
    'PASS: cancellation deadline is rechecked after lock wait, not request start',
  );

  const claimId = await draft(db, f);
  await execute(db, submit(f, claimId));
  const jobId = await db.query(
    `select id from private.notification_jobs where source_id='${claimId}';`,
  );
  const claimFirst = await race(
    db,
    'notification-claim-before-cancel',
    service(`select job_id from public.notification_claim('${jobId}');`),
    cancel(f, claimId),
  );
  assert.equal(JSON.parse(expectSuccess(claimFirst)).status, 'canceled');
  assert.equal(
    await db.query(
      `select state||':'||(cancellation_requested_at is not null)::text from private.notification_jobs where id='${jobId}';`,
    ),
    'leased:true',
  );
  console.info(
    'PASS: already claimed notification keeps its truthful lease plus cancellation request',
  );

  const noClaimId = await draft(db, f);
  await execute(db, submit(f, noClaimId));
  const noClaimJob = await db.query(
    `select id from private.notification_jobs where source_id='${noClaimId}';`,
  );
  const cancelFirst = await race(
    db,
    'cancel-before-notification-claim',
    cancel(f, noClaimId),
    service(`select count(*) from public.notification_claim('${noClaimJob}');`),
  );
  assert.equal(expectSuccess(cancelFirst), '0');
  console.info('PASS: cancellation winner prevents a later notification claim');

  const rollbackId = await draft(db, f);
  const a = await session('submit-crash'),
    b = await session('submit-crash-replay');
  try {
    const crashOperation = uuid();
    await a.query(`begin; ${submit(f, rollbackId, crashOperation)}`);
    const replay = b.query(
      `begin; ${submit(f, rollbackId, crashOperation)} commit;`,
    );
    await waitForBlock(db, b, a);
    await a.query('rollback;');
    assert.equal(JSON.parse(await replay).status, 'sent');
    await assertEffects(db, rollbackId, 'sent', 1);
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
  console.info(
    'PASS: failed response before commit retries stable operation exactly once',
  );

  await db.query(
    "update private.artist_dispatch_operations set created_at=clock_timestamp()-interval '2 minutes';",
  );
  for (let count = 0; count < 29; count++) {
    const id = await draft(db, f);
    await execute(db, submit(f, id));
  }
  const rateFirst = await draft(db, f),
    rateSecond = await draft(db, f);
  const rate = await race(
    db,
    'rate-final-slot',
    submit(f, rateFirst),
    submit(f, rateSecond),
  );
  assert.equal(JSON.parse(rate.winner).status, 'sent');
  expectError(rate, 'DISPATCH_RATE_LIMITED');
  await assertEffects(db, rateSecond, 'draft', 0);
  console.info(
    'PASS: competing submissions cannot both consume the last rolling-minute slot',
  );
}
try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(`select
    (select count(*) from auth.users)+(select count(*) from public.profiles)+
    (select count(*) from public.subscriptions)+(select count(*) from public.payment_events)+
    (select count(*) from public.messages)+(select count(*) from public.message_media)+
    (select count(*) from private.media_uploads)+(select count(*) from private.artist_compose_drafts)+
    (select count(*) from private.artist_compose_operations)+(select count(*) from private.artist_dispatch_submissions)+(select count(*) from private.artist_dispatch_operations)+(select count(*) from private.profile_onboarding_policy)+
    (select count(*) from private.message_policy)+
    (select count(*) from public.artists where id not in('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'));`),
    '0',
    'Use a freshly reset disposable local database with fictional seeds only; this test resets it afterward.',
  );
  shouldReset = true;
  await testConcurrency(db);
  console.info(
    'All dispatch PostgreSQL multi-session concurrency checks passed.',
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.all([...clients].map((client) => client.close()));
  if (shouldReset) {
    try {
      console.info(
        'Restoring the disposable local database after committed fixtures.',
      );
      execFileSync(localCli, ['db', 'reset', '--local'], { stdio: 'inherit' });
    } catch (error) {
      console.error(
        'Local fixture cleanup failed. Run npm run db:reset before using this disposable database again.',
        error,
      );
      process.exitCode = 1;
    }
  }
}
