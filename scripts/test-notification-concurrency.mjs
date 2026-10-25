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
    this.label = `notification-concurrency-${label}`;
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
    const marker = `NOTIFICATION_TEST_DONE_${++commandSequence}`;
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

// Only fictional local identities and opaque example.invalid subscription data.
// Nothing here invokes a delivery provider or proves an end device received data.
const uuid = () => crypto.randomUUID();
const service = (sql) => `set local role service_role; ${sql}`;
const authenticated = (userId, sql) =>
  `set local role authenticated; set local "request.jwt.claim.sub" = '${userId}'; ${sql}`;
const localCli = fileURLToPath(
  new URL('../node_modules/.bin/supabase', import.meta.url),
);
let shouldReset = false;

// Keep the winner's real RPC uncommitted until PostgreSQL proves the contender
// is blocked on it. Timeouts/deadlocks are failures, not expected race outcomes.
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
    assert.ok(finalize === 'commit' || finalize === 'rollback');
    await first.query(`${finalize};`);
    return { winner, following: await following };
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
}

// SKIP LOCKED intentionally does not wait. Prove overlap by requiring the
// contender to finish before releasing the first transaction's lease/job lock.
async function skipLockedRace(label, firstSql, secondSql) {
  const first = await session(`${label}-first`);
  const second = await session(`${label}-second`);
  try {
    const winner = await first.query(`begin; ${firstSql}`);
    const following = await second.query(`begin; ${secondSql} commit;`);
    await first.query('commit;');
    return { winner, following };
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
}

const execute = (db, sql) => db.query(`begin; ${sql} commit;`);
const register = (userId, endpoint) =>
  service(`select public.notification_register_device('${userId}', '${endpoint}',
    repeat('A',87), repeat('B',22), 'fictional-consent-v1');`);
const claim = (jobId) =>
  service(`select lease_token from public.notification_claim('${jobId}');`);
const claimCount = (jobId) =>
  service(`select count(*) from public.notification_claim('${jobId}');`);
const complete = (jobId, token, outcome, evidence = uuid()) =>
  service(
    `select public.notification_complete('${jobId}', '${token}', '${outcome}', '${evidence}');`,
  );
const cancel = (f, sourceId) =>
  service(`select public.messaging_cancel('${f.authorId}', '${sourceId}');`);
const state = (db, jobId) =>
  db.query(`select state from private.notification_jobs where id='${jobId}';`);
const attempts = (db, jobId) =>
  db.query(
    `select count(*) from private.notification_attempts where job_id='${jobId}';`,
  );

async function identity(db, role = 'fan') {
  const id = uuid();
  await db.query(`
    insert into auth.users(id,email,raw_user_meta_data)
      values ('${id}','notification-${id}@example.invalid','{}');
    update public.profiles set call_name='가상알림팬',
      onboarding_completed_at=clock_timestamp(),role='${role}' where id='${id}';
  `);
  return id;
}

async function fixture(db) {
  const fanId = await identity(db);
  const authorId = await identity(db, 'artist');
  const adminId = await identity(db, 'admin');
  const artistId = uuid();
  const subscriptionId = uuid();
  await db.query(`
    insert into public.artists(id,slug,name,grade,status)
      values ('${artistId}','notification-concurrency-${artistId}','Fictional notification artist','B','active');
    insert into public.artist_members(artist_id,user_id) values ('${artistId}','${authorId}');
    insert into public.subscriptions(id,user_id,artist_id,provider,status,
      first_started_at,episode_started_at,current_period_start,current_period_end)
      values ('${subscriptionId}','${fanId}','${artistId}','toss','active',
        statement_timestamp()-interval '1 day',statement_timestamp()-interval '1 day',
        statement_timestamp()-interval '1 day',statement_timestamp()+interval '30 days');
  `);
  await execute(
    db,
    authenticated(
      fanId,
      'select public.notification_set_preferences(true,true,true,true);',
    ),
  );
  const endpoint = `https://push.example.invalid/notification/${uuid()}`;
  const deviceId = await execute(db, register(fanId, endpoint));
  return {
    fanId,
    authorId,
    adminId,
    artistId,
    subscriptionId,
    endpoint,
    deviceId,
  };
}

async function message(db, f, sent = true) {
  const id = await execute(
    db,
    service(`select public.messaging_save_draft(
    '${f.authorId}','${f.artistId}',null,'text','Fictional outbox message');`),
  );
  await execute(
    db,
    service(`select public.messaging_schedule(
    '${f.authorId}','${id}',statement_timestamp());`),
  );
  if (sent) {
    assert.equal(
      await execute(db, service(`select public.messaging_dispatch('${id}');`)),
      't',
    );
  }
  return id;
}

async function messageJob(db, f) {
  const sourceId = await message(db, f);
  const jobId = await db.query(`select id from private.notification_jobs
    where source_kind='message' and source_id='${sourceId}' and user_id='${f.fanId}' and device_id='${f.deviceId}';`);
  assert.match(jobId, /^[0-9a-f-]{36}$/);
  return { sourceId, jobId };
}

// Upgrade only this fixture's legacy endpoint through the real session-bound
// registration path. Message/payment legacy ABI cases above remain unchanged.
async function bindScheduleDevice(db, f) {
  const sessionId = uuid();
  await db.query(`insert into auth.sessions(id,user_id,created_at,updated_at)
    values('${sessionId}','${f.fanId}',clock_timestamp(),clock_timestamp());`);
  assert.equal(
    await execute(
      db,
      service(`select public.webpush_register_device('${f.fanId}','${sessionId}',
        '${f.endpoint}',repeat('A',87),repeat('B',22),'fictional-consent-v1');`),
    ),
    f.deviceId,
  );
}

const nextDaySchedule = `(((clock_timestamp() at time zone 'Asia/Seoul')::date+1)::timestamp
  +interval '12 hours') at time zone 'Asia/Seoul'`;
const queueSchedule = (sourceId) =>
  service(
    `select push_jobs from public.schedule_notice_create('${sourceId}');`,
  );

async function scheduleJob(db, f) {
  await bindScheduleDevice(db, f);
  const sourceId = await execute(
    db,
    authenticated(
      f.adminId,
      `select public.schedule_create('${f.artistId}','event','Fictional reminder',
      ${nextDaySchedule},p_status=>'published');`,
    ),
  );
  assert.equal(await execute(db, queueSchedule(sourceId)), '1');
  const jobId = await db.query(`select id from private.notification_jobs
    where source_kind='schedule' and source_id='${sourceId}' and user_id='${f.fanId}' and device_id='${f.deviceId}';`);
  assert.match(jobId, /^[0-9a-f-]{36}$/);
  return { sourceId, jobId };
}

async function assertSuppressed(db, label, firstSql, jobId) {
  const result = await race(db, label, firstSql, claimCount(jobId));
  assert.equal(result.following.error, undefined);
  assert.equal(result.following.value, '0');
  assert.equal(await state(db, jobId), 'canceled');
  assert.equal(await attempts(db, jobId), '0');
}

async function testConcurrency(db) {
  await db.query(`
    insert into private.message_policy values
      (true,'fictional-message-policy-v1',604800,300,1000,100,10,180,60,5,
        10485760,20971520,104857600);
    insert into private.notification_policy(version,consent_version,webpush_enabled,
      max_attempts,retry_seconds,lease_seconds,schedule_lead_seconds)
      values ('fictional-notification-v1','fictional-consent-v1',true,3,1,30,86400);
    insert into private.schedule_notice_policies(version,hour_kst,approved_at,published_at)
      values ('c7100000-0000-4000-8000-000000000001',0,clock_timestamp(),clock_timestamp());
    insert into private.schedule_notice_policy_current(policy_version)
      values ('c7100000-0000-4000-8000-000000000001');
  `);

  // 1. A repeated registration is one device identity, even before first commit.
  const registerFan = await identity(db);
  const sharedEndpoint = `https://push.example.invalid/notification/${uuid()}`;
  const registered = await race(
    db,
    'same-device',
    register(registerFan, sharedEndpoint),
    register(registerFan, sharedEndpoint),
  );
  assert.equal(registered.following.error, undefined);
  assert.equal(registered.following.value, registered.winner);
  assert.equal(
    await db.query(
      `select count(*) from private.push_subscriptions where endpoint='${sharedEndpoint}';`,
    ),
    '1',
  );
  console.info(
    'PASS: overlapping own-device registration keeps one canonical identity',
  );

  // 2. Distinct authenticated actors cannot transfer a contested endpoint.
  const firstOwner = await identity(db);
  const secondOwner = await identity(db);
  const contestedEndpoint = `https://push.example.invalid/notification/${uuid()}`;
  const contested = await race(
    db,
    'endpoint-owner',
    register(firstOwner, contestedEndpoint),
    register(secondOwner, contestedEndpoint),
  );
  assert.match(
    contested.following.error?.message ?? '',
    /OWNER|CONFLICT|REGISTERED/,
  );
  assert.equal(
    await db.query(
      `select user_id from private.push_subscriptions where endpoint='${contestedEndpoint}';`,
    ),
    firstOwner,
  );
  console.info(
    'PASS: cross-owner endpoint contention cannot steal a private subscription',
  );

  // 3. Actual messaging dispatch and its outbox trigger commit one source fanout.
  const dispatchFixture = await fixture(db);
  const dispatchSource = await message(db, dispatchFixture, false);
  const dispatchSql = service(
    `select public.messaging_dispatch('${dispatchSource}');`,
  );
  const dispatched = await race(
    db,
    'dispatch-enqueue',
    dispatchSql,
    dispatchSql,
  );
  assert.equal(dispatched.winner, 't');
  assert.equal(dispatched.following.error, undefined);
  assert.equal(dispatched.following.value, 'f');
  assert.equal(
    await db.query(
      `select count(*) from private.notification_jobs where source_kind='message' and source_id='${dispatchSource}';`,
    ),
    '1',
  );
  console.info(
    'PASS: overlapping source dispatch atomically creates one deduplicated outbox job',
  );

  // 4. The loser must return while the first claim is still uncommitted.
  const exclusiveFixture = await fixture(db);
  const exclusive = await messageJob(db, exclusiveFixture);
  const claimed = await skipLockedRace(
    'one-worker',
    claim(exclusive.jobId),
    claimCount(exclusive.jobId),
  );
  assert.match(claimed.winner, /^[0-9a-f-]{36}$/);
  assert.equal(claimed.following, '0');
  assert.equal(await attempts(db, exclusive.jobId), '1');
  assert.equal(await state(db, exclusive.jobId), 'leased');
  console.info(
    'PASS: simultaneous workers cannot acquire two leases for one delivery identity',
  );

  // 5. Cancellation wins the authoritative source lock before lease eligibility.
  const cancelFixture = await fixture(db);
  const cancelJob = await messageJob(db, cancelFixture);
  await assertSuppressed(
    db,
    'cancel-before-claim',
    cancel(cancelFixture, cancelJob.sourceId),
    cancelJob.jobId,
  );
  console.info(
    'PASS: source cancellation committed before claim prevents any attempt',
  );

  // 6. Claim wins: cancellation cannot honestly retract a possible provider send.
  const inflightFixture = await fixture(db);
  const inflight = await messageJob(db, inflightFixture);
  const claimFirst = await race(
    db,
    'claim-before-cancel',
    claim(inflight.jobId),
    cancel(inflightFixture, inflight.sourceId),
  );
  assert.match(claimFirst.winner, /^[0-9a-f-]{36}$/);
  assert.equal(claimFirst.following.error, undefined);
  assert.equal(await state(db, inflight.jobId), 'leased');
  assert.equal(
    await db.query(
      `select cancellation_requested_at is not null from private.notification_jobs where id='${inflight.jobId}';`,
    ),
    't',
  );
  assert.equal(
    await execute(
      db,
      complete(inflight.jobId, claimFirst.winner, 'provider_accepted'),
    ),
    'provider_accepted',
  );
  assert.equal(await attempts(db, inflight.jobId), '1');
  console.info(
    'PASS: cancellation after claim retains in-flight identity and honest provider acceptance',
  );

  // 7. A proven non-send may retry, but cancellation wins before retry leasing.
  const retryFixture = await fixture(db);
  const retry = await messageJob(db, retryFixture);
  const retryToken = await execute(db, claim(retry.jobId));
  assert.equal(
    await execute(db, complete(retry.jobId, retryToken, 'not_sent')),
    'retry_wait',
  );
  await db.query(
    `update private.notification_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id='${retry.jobId}';`,
  );
  const canceledRetry = await race(
    db,
    'cancel-before-retry',
    cancel(retryFixture, retry.sourceId),
    claimCount(retry.jobId),
  );
  assert.equal(canceledRetry.following.error, undefined);
  assert.equal(canceledRetry.following.value, '0');
  assert.equal(await state(db, retry.jobId), 'canceled');
  assert.equal(await attempts(db, retry.jobId), '1');
  console.info(
    'PASS: cancellation fences a verified retry without opening another attempt',
  );

  // 8. Device revocation serializes before any endpoint/key material is leased.
  const revokeFixture = await fixture(db);
  const revoked = await messageJob(db, revokeFixture);
  await assertSuppressed(
    db,
    'revoke-before-claim',
    service(
      `select public.notification_revoke_device('${revokeFixture.fanId}','${revokeFixture.deviceId}');`,
    ),
    revoked.jobId,
  );
  assert.equal(
    await db.query(
      `select state from private.push_subscriptions where id='${revokeFixture.deviceId}';`,
    ),
    'revoked',
  );
  console.info(
    'PASS: revoking an owned device prevents a pending worker from reading its material',
  );

  // 9. A profile change that committed while claim waited must be authoritative.
  const restrictedFixture = await fixture(db);
  const restricted = await messageJob(db, restrictedFixture);
  await assertSuppressed(
    db,
    'restriction-before-claim',
    `update public.profiles set is_restricted=true where id='${restrictedFixture.fanId}';`,
    restricted.jobId,
  );
  console.info(
    'PASS: current recipient restriction is rechecked after profile lock wait',
  );

  // 10. Pausing the source artist suppresses already-enqueued content.
  const pausedFixture = await fixture(db);
  const paused = await messageJob(db, pausedFixture);
  await assertSuppressed(
    db,
    'deactivate-before-claim',
    `update public.artists set status='paused' where id='${pausedFixture.artistId}';`,
    paused.jobId,
  );
  console.info(
    'PASS: artist deactivation wins against a waiting notification claim',
  );

  // 11. Paid access has an exclusive wall-clock end, not an enqueue-time snapshot.
  const expiredFixture = await fixture(db);
  const expired = await messageJob(db, expiredFixture);
  await assertSuppressed(
    db,
    'expire-before-claim',
    `update public.subscriptions set status='expired',next_billing_at=null,current_period_end=clock_timestamp()-interval '1 second' where id='${expiredFixture.subscriptionId}';`,
    expired.jobId,
  );
  console.info(
    'PASS: subscription expiry prevents claim of a previously eligible message',
  );

  // 12. Preference changes share the recipient serialization boundary.
  const preferenceFixture = await fixture(db);
  const preference = await messageJob(db, preferenceFixture);
  await assertSuppressed(
    db,
    'preference-before-claim',
    authenticated(
      preferenceFixture.fanId,
      'select public.notification_set_preferences(true,false,true,true);',
    ),
    preference.jobId,
  );
  console.info(
    'PASS: disabling one notification type suppresses its pending delivery',
  );

  // 13. Per-event opt-out is checked after the source and recipient locks.
  const optoutFixture = await fixture(db);
  const optout = await scheduleJob(db, optoutFixture);
  await assertSuppressed(
    db,
    'optout-before-claim',
    authenticated(
      optoutFixture.fanId,
      `select public.schedule_set_notification('${optout.sourceId}',false);`,
    ),
    optout.jobId,
  );
  console.info(
    'PASS: a concurrent per-event opt-out prevents reminder leasing',
  );

  // 14. Physical deletion still works without discarding the audit source UUID.
  const deleteFixture = await fixture(db);
  const deleted = await scheduleJob(db, deleteFixture);
  await assertSuppressed(
    db,
    'delete-before-claim',
    authenticated(
      deleteFixture.adminId,
      `select public.schedule_delete('${deleted.sourceId}');`,
    ),
    deleted.jobId,
  );
  assert.equal(
    await db.query(
      `select source_id='${deleted.sourceId}' and schedule_id is null from private.notification_jobs where id='${deleted.jobId}';`,
    ),
    't',
  );
  console.info(
    'PASS: deleting a source schedule cancels delivery and retains canonical source identity',
  );

  // 15. Dispatch/outbox rollback is indivisible; a waiting retry performs it once.
  const rollbackFixture = await fixture(db);
  const rollbackSource = await message(db, rollbackFixture, false);
  const rollbackSql = service(
    `select public.messaging_dispatch('${rollbackSource}');`,
  );
  const rolledBack = await race(
    db,
    'rollback-dispatch',
    rollbackSql,
    rollbackSql,
    'rollback',
  );
  assert.equal(rolledBack.winner, 't');
  assert.equal(rolledBack.following.error, undefined);
  assert.equal(rolledBack.following.value, 't');
  assert.equal(
    await db.query(
      `select count(*) from private.notification_jobs where source_kind='message' and source_id='${rollbackSource}';`,
    ),
    '1',
  );
  console.info(
    'PASS: rollback removes source transition and fanout together before a safe replay',
  );

  // 16. Expiration is ambiguous, not evidence of failure. Two recovery workers
  // cannot allocate a fresh token, even while the first marks unknown uncommitted.
  const unknownFixture = await fixture(db);
  const unknown = await messageJob(db, unknownFixture);
  const originalToken = await execute(db, claim(unknown.jobId));
  await db.query(`
    update private.notification_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id='${unknown.jobId}';
    update private.notification_attempts set lease_expires_at=clock_timestamp()-interval '1 second' where job_id='${unknown.jobId}';
  `);
  const recovered = await skipLockedRace(
    'expired-lease',
    claimCount(unknown.jobId),
    claimCount(unknown.jobId),
  );
  assert.equal(recovered.winner, '0');
  assert.equal(recovered.following, '0');
  assert.equal(await state(db, unknown.jobId), 'unknown');
  assert.equal(await attempts(db, unknown.jobId), '1');
  assert.equal(
    await execute(
      db,
      complete(unknown.jobId, originalToken, 'provider_accepted'),
    ),
    'provider_accepted',
  );
  assert.equal(await attempts(db, unknown.jobId), '1');
  console.info(
    'PASS: expired leases become unknown without dual workers and accept reconciled late evidence',
  );

  // 17. Retry wins the lease before cancellation: the old attempt stays final,
  // and only the new token can finish the remaining in-flight attempt.
  const retryWinnerFixture = await fixture(db);
  const retryWinner = await messageJob(db, retryWinnerFixture);
  const oldToken = await execute(db, claim(retryWinner.jobId));
  assert.equal(
    await execute(db, complete(retryWinner.jobId, oldToken, 'not_sent')),
    'retry_wait',
  );
  await db.query(
    `update private.notification_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id='${retryWinner.jobId}';`,
  );
  const retryWon = await race(
    db,
    'retry-before-cancel',
    claim(retryWinner.jobId),
    cancel(retryWinnerFixture, retryWinner.sourceId),
  );
  assert.match(retryWon.winner, /^[0-9a-f-]{36}$/);
  assert.notEqual(retryWon.winner, oldToken);
  assert.equal(retryWon.following.error, undefined);
  assert.equal(await state(db, retryWinner.jobId), 'leased');
  assert.equal(await attempts(db, retryWinner.jobId), '2');
  assert.equal(
    await db.query(
      `select cancellation_requested_at is not null from private.notification_jobs where id='${retryWinner.jobId}';`,
    ),
    't',
  );
  assert.equal(
    await execute(db, complete(retryWinner.jobId, retryWon.winner, 'not_sent')),
    'canceled',
  );
  console.info(
    'PASS: retry-before-cancel retains attempt history but never schedules another delivery',
  );

  // 18. This exact interleave catches an implicit FK lock inversion that a pair
  // of completed RPC replays cannot find. Publication owns the schedule row;
  // opt-out then owns the recipient profile FOR UPDATE and waits on that row.
  // Explicit approved next-day enqueue must not take a redundant profile KEY
  // SHARE FK lock while inserting the outbox. Owner integrity remains guaranteed by
  // the composite (device_id,user_id) FK to the private device owner.
  const publicationFixture = await fixture(db);
  await bindScheduleDevice(db, publicationFixture);
  const publicationSource = await execute(
    db,
    authenticated(
      publicationFixture.adminId,
      `select public.schedule_create('${publicationFixture.artistId}','event','Fictional unpublished event',
        ${nextDaySchedule},p_status=>'draft');`,
    ),
  );
  assert.equal(
    await db.query(`select count(*) from private.notification_jobs
      where source_kind='schedule' and source_id='${publicationSource}';`),
    '0',
  );
  const publisher = await session('publication-profile-fk-publisher');
  const optingOut = await session('publication-profile-fk-optout');
  try {
    await publisher.query(`begin; select id from public.schedules
      where id='${publicationSource}' for update;`);
    const pendingOptout = optingOut
      .query(
        `begin; ${authenticated(
          publicationFixture.fanId,
          `select public.schedule_set_notification('${publicationSource}',false);`,
        )} commit;`,
      )
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    await waitForBlock(db, optingOut, publisher);
    const published = await publisher.query(
      `${authenticated(
        publicationFixture.adminId,
        `select public.schedule_update('${publicationSource}','event','Fictional published event',
          ${nextDaySchedule},p_status=>'published');`,
      )}`,
    );
    assert.equal(published, publicationSource);
    assert.equal(
      await publisher.query(`${queueSchedule(publicationSource)} commit;`),
      '1',
    );
    const optoutResult = await pendingOptout;
    assert.equal(optoutResult.error, undefined);
    assert.equal(optoutResult.value, 'f');
    const publicationJob =
      await db.query(`select id from private.notification_jobs
      where source_kind='schedule' and source_id='${publicationSource}'
        and user_id='${publicationFixture.fanId}' and device_id='${publicationFixture.deviceId}';`);
    assert.match(publicationJob, /^[0-9a-f-]{36}$/);
    assert.equal(await execute(db, claimCount(publicationJob)), '0');
    assert.equal(await state(db, publicationJob), 'canceled');
    assert.equal(await attempts(db, publicationJob), '0');
  } finally {
    await Promise.all([publisher.close(), optingOut.close()]);
  }
  console.info(
    'PASS: approved next-day queue and opt-out avoid implicit recipient FK deadlock and honor committed opt-out',
  );

  // 19. Stage the old sibling-job inversion, not merely two serialized calls.
  // Preferences own the profile and sibling B. Completion of C must wait on the
  // profile BEFORE taking C/device and cleaning up B. Without that profile lock,
  // completion holds C waiting on B while the preference update waits on C.
  const deadFixture = await fixture(db);
  const deadSibling = await messageJob(db, deadFixture);
  const deadPrimary = await messageJob(db, deadFixture);
  const deadToken = await execute(db, claim(deadPrimary.jobId));
  const preferences = await session('dead-sibling-preferences');
  const completion = await session('dead-sibling-completion');
  try {
    await preferences.query(`begin;
      select id from public.profiles where id='${deadFixture.fanId}' for update;
      select id from private.notification_jobs where id='${deadSibling.jobId}' for update;`);
    const pendingCompletion = completion
      .query(
        `begin; ${complete(deadPrimary.jobId, deadToken, 'dead_endpoint')} commit;`,
      )
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    await waitForBlock(db, completion, preferences);
    await preferences.query(
      `${authenticated(
        deadFixture.fanId,
        'select public.notification_set_preferences(false,false,false,false);',
      )} commit;`,
    );
    const completed = await pendingCompletion;
    assert.equal(completed.error, undefined);
    assert.equal(completed.value, 'dead_endpoint');
    assert.equal(await state(db, deadPrimary.jobId), 'dead_endpoint');
    assert.equal(await state(db, deadSibling.jobId), 'canceled');
    assert.equal(await attempts(db, deadPrimary.jobId), '1');
    assert.equal(await attempts(db, deadSibling.jobId), '0');
    assert.equal(
      await db.query(
        `select state from private.push_subscriptions where id='${deadFixture.deviceId}';`,
      ),
      'dead',
    );
    assert.equal(await execute(db, claimCount(deadPrimary.jobId)), '0');
    assert.equal(await execute(db, claimCount(deadSibling.jobId)), '0');
  } finally {
    await Promise.all([preferences.close(), completion.close()]);
  }
  console.info(
    'PASS: preference cancellation and dead-endpoint sibling cleanup share profile-first order without deadlock',
  );

  // 20. Deterministically prove sorted sibling locks precede the primary lock.
  // Query UUID order instead of relying on random insertion/heap order. A gate
  // owns the low sibling B, so completion of high C must wait BEFORE locking C.
  // A third real source cancellation can then finish C while the gate is held.
  // The previous primary-first code instead held C while waiting on B, blocking
  // that cancellation and enabling cycles among overlapping source/device sets.
  const orderedFixture = await fixture(db);
  await messageJob(db, orderedFixture);
  await messageJob(db, orderedFixture);
  const orderedJobs = (
    await db.query(`select id,source_id from private.notification_jobs
      where device_id='${orderedFixture.deviceId}' order by id;`)
  )
    .split('\n')
    .map((row) => row.split('|'));
  assert.equal(orderedJobs.length, 2);
  const [lowJob] = orderedJobs[0];
  const [highJob, highSource] = orderedJobs[1];
  assert.ok(lowJob < highJob);
  const orderedToken = await execute(db, claim(highJob));
  const gate = await session('ordered-sibling-gate');
  const sortedCompletion = await session('ordered-sibling-completion');
  const sourceCancellation = await session('ordered-sibling-source-cancel');
  try {
    await gate.query(`begin; select id from private.notification_jobs
      where id='${lowJob}' for update;`);
    const pendingSortedCompletion = sortedCompletion
      .query(
        `begin; ${complete(highJob, orderedToken, 'dead_endpoint')} commit;`,
      )
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    await waitForBlock(db, sortedCompletion, gate);
    // Must finish before gate.commit, not merely after releasing both workers.
    await sourceCancellation.query(
      `begin; ${cancel(orderedFixture, highSource)} commit;`,
    );
    await waitForBlock(db, sortedCompletion, gate);
    assert.equal(await state(db, highJob), 'leased');
    assert.equal(
      await db.query(`select cancellation_requested_at is not null
        from private.notification_jobs where id='${highJob}';`),
      't',
    );
    await gate.query('commit;');
    const sortedResult = await pendingSortedCompletion;
    assert.equal(sortedResult.error, undefined);
    assert.equal(sortedResult.value, 'dead_endpoint');
    assert.equal(await state(db, highJob), 'dead_endpoint');
    assert.equal(await state(db, lowJob), 'canceled');
    assert.equal(await attempts(db, highJob), '1');
    assert.equal(await attempts(db, lowJob), '0');
    assert.equal(
      await db.query(`select state from private.push_subscriptions
        where id='${orderedFixture.deviceId}';`),
      'dead',
    );
  } finally {
    await Promise.all([
      gate.close(),
      sortedCompletion.close(),
      sourceCancellation.close(),
    ]);
  }
  console.info(
    'PASS: dead-endpoint completion locks lower sibling before primary and allows independent source cancellation',
  );

  // 21. Freeze the exact locked set against a READ COMMITTED phantom. H and G
  // have no attempts when fixture UUIDs are replaced. Their deliberately high
  // UUIDs ensure every newly generated v4 UUID L sorts before H (not row luck).
  // Preferences lock H and wait on gated G; enqueue adds L from another device;
  // source cancellation then locks L and waits on H. After releasing G, an
  // unbounded second UPDATE snapshot would see L and deadlock H <-> L. Updating
  // only the captured, already-locked UUID array must finish without touching L.
  const phantomFixture = await fixture(db);
  const phantomSource = await messageJob(db, phantomFixture);
  const phantomOther = await messageJob(db, phantomFixture);
  const heldJob = 'ffffffff-ffff-ffff-ffff-fffffffffffe';
  const gateJob = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  await db.query(`
    update private.notification_jobs set id='${heldJob}' where id='${phantomSource.jobId}';
    update private.notification_jobs set id='${gateJob}' where id='${phantomOther.jobId}';
  `);
  const phantomDevice = await execute(
    db,
    register(
      phantomFixture.fanId,
      `https://push.example.invalid/notification/${uuid()}`,
    ),
  );
  const phantomGate = await session('phantom-gate');
  const phantomPreferences = await session('phantom-preferences');
  const phantomEnqueue = await session('phantom-enqueue');
  const phantomCancellation = await session('phantom-source-cancel');
  try {
    await phantomGate.query(`begin; select id from private.notification_jobs
      where id='${gateJob}' for update;`);
    const pendingPreferences = phantomPreferences
      .query(
        `begin; ${authenticated(
          phantomFixture.fanId,
          'select public.notification_set_preferences(false,false,false,false);',
        )} commit;`,
      )
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    await waitForBlock(db, phantomPreferences, phantomGate);
    assert.equal(
      await phantomEnqueue.query(
        `begin; ${service(`select public.notification_enqueue('message','${phantomSource.sourceId}');`)} commit;`,
      ),
      '1',
    );
    const phantomJob = await db.query(`select id from private.notification_jobs
      where source_kind='message' and source_id='${phantomSource.sourceId}'
        and device_id='${phantomDevice}';`);
    assert.match(
      phantomJob,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.ok(phantomJob < heldJob);
    const pendingCancellation = phantomCancellation
      .query(`begin; ${cancel(phantomFixture, phantomSource.sourceId)} commit;`)
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    await waitForBlock(db, phantomCancellation, phantomPreferences);
    await phantomGate.query('commit;');
    const [preferenceResult, cancellationResult] = await Promise.all([
      pendingPreferences,
      pendingCancellation,
    ]);
    assert.equal(preferenceResult.error, undefined);
    assert.equal(cancellationResult.error, undefined);
    for (const id of [heldJob, gateJob, phantomJob]) {
      assert.equal(await state(db, id), 'canceled');
      assert.equal(await attempts(db, id), '0');
      assert.equal(await execute(db, claimCount(id)), '0');
    }
    assert.equal(
      await db.query(`select count(*) from private.notification_jobs
        where user_id='${phantomFixture.fanId}';`),
      '3',
    );
  } finally {
    await Promise.all([
      phantomGate.close(),
      phantomPreferences.close(),
      phantomEnqueue.close(),
      phantomCancellation.close(),
    ]);
  }
  console.info(
    'PASS: captured sorted job sets exclude concurrent enqueue phantoms and avoid preference/source deadlock',
  );
}

try {
  assertLocalDocker();
  const db = await session('observer');
  // Refuse user data before authorizing fixture writes or the teardown reset.
  // Private bucket configuration is a migration, not a user data row.
  assert.equal(
    await db.query(`select
      (select count(*) from auth.users) +
      (select count(*) from auth.sessions) +
      (select count(*) from public.profiles) +
      (select count(*) from public.artist_members) +
      (select count(*) from public.subscriptions) +
      (select count(*) from public.payment_events) +
      (select count(*) from private.payment_mandates) +
      (select count(*) from private.billing_obligations) +
      (select count(*) from private.payment_attempts) +
      (select count(*) from private.payment_event_verifications) +
      (select count(*) from public.messages) +
      (select count(*) from public.message_media) +
      (select count(*) from public.message_reads) +
      (select count(*) from public.replies) +
      (select count(*) from private.message_policy) +
      (select count(*) from public.posts) +
      (select count(*) from public.comments) +
      (select count(*) from public.post_likes) +
      (select count(*) from public.reports) +
      (select count(*) from private.community_policy) +
      (select count(*) from private.community_rate_limits) +
      (select count(*) from public.post_images) +
      (select count(*) from public.community_moderation_log) +
      (select count(*) from public.schedules) +
      (select count(*) from public.schedule_notification_optouts) +
      (select count(*) from public.content_calendar) +
      (select count(*) from public.calendar_audit_log) +
      (select count(*) from private.point_policy) +
      (select count(*) from private.point_ledger) +
      (select count(*) from private.notification_policy) +
      (select count(*) from private.schedule_notice_policies) +
      (select count(*) from private.schedule_notice_policy_current) +
      (select count(*) from private.schedule_notice_scan_cursor) +
      (select count(*) from private.notification_preferences) +
      (select count(*) from private.push_subscriptions) +
      (select count(*) from private.notification_jobs) +
      (select count(*) from private.notification_attempts) +
      (select count(*) from storage.objects) +
      (select count(*) from public.artists where id not in (
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002'));`),
    '0',
    'Use a freshly reset disposable local database with fictional seeds only; this test resets it afterward.',
  );
  shouldReset = true;
  await testConcurrency(db);
  console.info(
    'All twenty-one PostgreSQL multi-session notification concurrency checks passed.',
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
