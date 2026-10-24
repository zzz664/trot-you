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
    this.label = `analytics-concurrency-${label}`;
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
    const marker = `ANALYTICS_TEST_DONE_${++commandSequence}`;
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

// Only fictional local identities. Nothing invokes a payment or analytics provider.
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
// contender to finish before releasing the first transaction's row lock.
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
const consentVersion = 'e3000000-0000-4000-8000-000000000001';
const consent = (userId, granted) =>
  authenticated(
    userId,
    `select public.analytics_set_consent(${granted},'${consentVersion}');`,
  );
const collect = (userId, key, context = 'reply') =>
  authenticated(
    userId,
    `select public.analytics_record_client('${key}','voice_input_used',p_voice_context=>'${context}');`,
  );
const countEvents = (db, userId) =>
  db.query(
    `select count(*) from private.analytics_events where user_id='${userId}';`,
  );
const assertError = (result, expected) =>
  assert.match(result.error?.message ?? '', expected);

async function identity(db) {
  const id = uuid();
  await db.query(`
    insert into auth.users(id,email,raw_user_meta_data)
      values ('${id}','analytics-${id}@example.invalid','{}');
    update public.profiles set call_name='Fictional analytics user',
      onboarding_completed_at=clock_timestamp() where id='${id}';
  `);
  await execute(db, consent(id, true));
  return id;
}

async function artist(db) {
  const id = uuid();
  await db.query(`insert into public.artists(id,slug,name,grade,status)
    values ('${id}','analytics-concurrency-${id}','Fictional analytics artist','B','active');`);
  return id;
}

// Build evidence through the real billing RPC sequence, not a fake money event.
// Provider approval fields are fictional local verification fixtures only; no
// external payment request or claim of an actual provider approval is made.
async function verifiedCharge(db, userId, artistId) {
  const subscriptionId = await execute(
    db,
    service(
      `select public.billing_open_subscription('${userId}','${artistId}','toss');`,
    ),
  );
  await execute(
    db,
    service(
      `select public.billing_register_mandate('${subscriptionId}','test','fictional-analytics-merchant',
      '${uuid()}','${uuid()}','fictional-billing-consent-v1');`,
    ),
  );
  const obligationId = await execute(
    db,
    service(
      `select public.billing_prepare_obligation('${subscriptionId}',statement_timestamp(),
      statement_timestamp()+interval '30 days',6500,false,'fictional-price-v1',259200,3600,2);`,
    ),
  );
  const attemptId = await execute(
    db,
    service(`select public.billing_prepare_attempt('${obligationId}');`),
  );
  const claim = await execute(
    db,
    service(`select public.billing_claim_attempt('${attemptId}',30);`),
  );
  assert.equal(JSON.parse(claim).attempt_id, attemptId);
  return execute(
    db,
    service(
      `select public.billing_finalize_charge('${attemptId}','fictional-action-${uuid()}',6500,
      'KRW',statement_timestamp(),'${uuid()}');`,
    ),
  );
}

async function testConcurrency(db) {
  // Fictional approved/public analytics text, removed by the existing final DB reset.
  await db.query(`insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at)
    values('${consentVersion}','analytics','Fictional concurrency policy',
      'Fictional local CI test policy only; not legal text.',now(),now());`);
  await db.query(`insert into private.analytics_policy(consent_version,enabled,retention_days)
    values('${consentVersion}',true,30);`);

  // 1. Compatible profile/policy SHARE locks reach the unique event key. The
  // second transaction must wait on the first insertion and return its exact ID.
  const duplicateUser = await identity(db);
  const duplicateKey = uuid();
  const duplicate = await race(
    db,
    'duplicate-client',
    collect(duplicateUser, duplicateKey),
    collect(duplicateUser, duplicateKey),
  );
  assert.equal(duplicate.following.error, undefined);
  assert.equal(duplicate.following.value, duplicate.winner);
  assert.equal(await countEvents(db, duplicateUser), '1');
  console.info(
    'PASS: concurrent client retry keys produce one event and one returned identity',
  );

  // 2. A blocked conflicting payload cannot silently reuse the successful key.
  const conflictUser = await identity(db);
  const conflictKey = uuid();
  const conflict = await race(
    db,
    'conflicting-client',
    collect(conflictUser, conflictKey),
    collect(conflictUser, conflictKey, 'post'),
  );
  assertError(conflict.following, /ANALYTICS_EVENT_CONFLICT/);
  assert.equal(await countEvents(db, conflictUser), '1');
  assert.equal(
    await db.query(`select voice_context from private.analytics_events
    where user_id='${conflictUser}';`),
    'reply',
  );
  console.info(
    'PASS: a conflicting concurrent retry fails instead of overwriting the observation',
  );

  // 3. Aborted idempotency ownership never reserves a key or leaks an event.
  const rollbackUser = await identity(db);
  const rollbackKey = uuid();
  const rollback = await race(
    db,
    'rollback-client',
    collect(rollbackUser, rollbackKey),
    collect(rollbackUser, rollbackKey),
    'rollback',
  );
  assert.equal(rollback.following.error, undefined);
  assert.notEqual(rollback.following.value, rollback.winner);
  assert.equal(await countEvents(db, rollbackUser), '1');
  assert.equal(
    await db.query(
      `select id from private.analytics_events where user_id='${rollbackUser}';`,
    ),
    rollback.following.value,
  );
  console.info(
    'PASS: a waiting retry commits once after the original event transaction rolls back',
  );

  // 4. A stable source may not acquire an unrecorded retry-key alias. A second
  // key conflicts after waiting; the original source still has exactly one event.
  const postUser = await identity(db);
  const artistId = await artist(db);
  const postId = uuid();
  await db.query(`insert into public.posts(id,artist_id,user_id,request_id,title,body)
    values('${postId}','${artistId}','${postUser}','${uuid()}',
      'Fictional analytics source','Fictional local source body');`);
  const recordPost = (key) =>
    service(`select public.analytics_record_server('${postUser}',
    '${key}','post_create','${postId}');`);
  const post = await race(
    db,
    'same-source-different-key',
    recordPost(uuid()),
    recordPost(uuid()),
  );
  assertError(post.following, /ANALYTICS_EVENT_CONFLICT/);
  assert.equal(await countEvents(db, postUser), '1');
  console.info(
    'PASS: a concurrent different-key source replay is rejected without creating an alias or duplicate metric',
  );

  // 5. The charge path derives its own user/type/key from verified ledger rows.
  const chargeUser = await identity(db);
  const chargeId = await verifiedCharge(db, chargeUser, artistId);
  const recordCharge = service(
    `select public.analytics_record_charge('${chargeId}');`,
  );
  const charge = await race(db, 'verified-charge', recordCharge, recordCharge);
  assert.equal(charge.following.error, undefined);
  assert.equal(charge.following.value, charge.winner);
  assert.equal(await countEvents(db, chargeUser), '1');
  assert.equal(
    await db.query(`select name||'|'||origin from private.analytics_events
    where user_id='${chargeUser}';`),
    'subscribe_complete|verified_charge',
  );
  assert.equal(
    await db.query(
      `select count(*) from public.payment_events where id='${chargeId}';`,
    ),
    '1',
  );
  console.info(
    'PASS: concurrent verified-charge ingestion counts once without duplicating financial effects',
  );

  // 6. An already committed withdrawal wins over collection waiting on profile.
  const withdrawUser = await identity(db);
  const withdrawn = await race(
    db,
    'withdraw-before-collect',
    consent(withdrawUser, false),
    collect(withdrawUser, uuid()),
  );
  assertError(withdrawn.following, /ANALYTICS_CONSENT_REQUIRED/);
  assert.equal(await countEvents(db, withdrawUser), '0');
  console.info(
    'PASS: withdrawal serializes ahead of waiting collection and prevents its row',
  );

  // 7. Reverse interleave: an accepted, committed prior event is not rewritten
  // as uncollected; withdrawal waits and then blocks all later observations.
  const beforeWithdrawUser = await identity(db);
  const beforeWithdrawal = await race(
    db,
    'collect-before-withdraw',
    collect(beforeWithdrawUser, uuid()),
    consent(beforeWithdrawUser, false),
  );
  assert.equal(beforeWithdrawal.following.error, undefined);
  assert.equal(await countEvents(db, beforeWithdrawUser), '1');
  assert.equal(
    await db.query(`select granted from private.analytics_consents
    where user_id='${beforeWithdrawUser}';`),
    'f',
  );
  const later = await session('after-withdrawal');
  try {
    await assert.rejects(
      later.query(`begin; ${collect(beforeWithdrawUser, uuid())} commit;`),
      /ANALYTICS_CONSENT_REQUIRED/,
    );
  } finally {
    await later.close();
  }
  assert.equal(await countEvents(db, beforeWithdrawUser), '1');
  console.info(
    'PASS: intake-before-withdrawal preserves only the prior event and suppresses later intake',
  );

  // 8. Policy write conflicts with collection SHARE lock and is re-read after
  // waiting. Configuration is an explicit local fixture, never application DML.
  const policyUser = await identity(db);
  const disabled = await race(
    db,
    'policy-disable-before-collect',
    'update private.analytics_policy set enabled=false;',
    collect(policyUser, uuid()),
  );
  assertError(disabled.following, /ANALYTICS_CONSENT_REQUIRED/);
  assert.equal(await countEvents(db, policyUser), '0');
  await db.query('update private.analytics_policy set enabled=true;');
  console.info(
    'PASS: policy disable wins over waiting collection instead of retaining a stale enabled snapshot',
  );

  // 9. Profile restrictions share the same lock gate as consent withdrawal.
  const restrictedUser = await identity(db);
  const restricted = await race(
    db,
    'restrict-before-collect',
    `update public.profiles set is_restricted=true where id='${restrictedUser}';`,
    collect(restrictedUser, uuid()),
  );
  assertError(restricted.following, /ANALYTICS_ACTOR_FORBIDDEN/);
  assert.equal(await countEvents(db, restrictedUser), '0');
  console.info(
    'PASS: a concurrent restriction prevents collection after the identity lock is released',
  );

  // 10. Two maintenance workers must finish separate bounded batches while the
  // first deletion remains uncommitted. SKIP LOCKED prevents blocking/double work.
  const purgeUser = await identity(db);
  await db.query(`insert into private.analytics_events(user_id,event_key,name,origin,
    voice_context,consent_version,occurred_at,recorded_at)
    select '${purgeUser}',gen_random_uuid(),'voice_input_used','client','reply','${consentVersion}',
      clock_timestamp()-interval '31 days',clock_timestamp()-interval '31 days'
      from generate_series(1,3);`);
  const purge = await skipLockedRace(
    'parallel-retention',
    service('select public.analytics_purge_expired(1);'),
    service('select public.analytics_purge_expired(1);'),
  );
  assert.equal(purge.winner, '1');
  assert.equal(purge.following, '1');
  assert.equal(await countEvents(db, purgeUser), '1');
  assert.equal(
    await db.query(
      `select count(*) from public.payment_events where id='${chargeId}';`,
    ),
    '1',
  );
  console.info(
    'PASS: parallel retention batches skip held rows, respect the limit and leave payment evidence intact',
  );

  // Supplemental overlapping visibility/rollback check, not another lock race:
  // a future service may include source creation and collection in one DB tx.
  // Neither source nor observation becomes visible to the independent observer
  // before commit, and rollback removes both. This does not add an automatic hook.
  const atomicUser = await identity(db);
  const atomicPost = uuid();
  const atomic = await session('source-rollback');
  try {
    const recorded = await atomic.query(`begin;
      insert into public.posts(id,artist_id,user_id,request_id,title,body)
        values('${atomicPost}','${artistId}','${atomicUser}','${uuid()}',
          'Fictional rolled-back source','Fictional rollback body');
      ${service(`select public.analytics_record_server('${atomicUser}','${uuid()}',
        'post_create','${atomicPost}');`)}`);
    assert.match(recorded, /^[0-9a-f-]{36}$/);
    assert.equal(await countEvents(db, atomicUser), '0');
    assert.equal(
      await db.query(
        `select count(*) from public.posts where id='${atomicPost}';`,
      ),
      '0',
    );
    await atomic.query('rollback;');
    assert.equal(await countEvents(db, atomicUser), '0');
    assert.equal(
      await db.query(
        `select count(*) from public.posts where id='${atomicPost}';`,
      ),
      '0',
    );
  } finally {
    await atomic.close();
  }
  console.info(
    'PASS: overlapping observer never sees uncommitted source or analytics and rollback removes both',
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
      (select count(*) from private.notification_preferences) +
      (select count(*) from private.push_subscriptions) +
      (select count(*) from private.notification_jobs) +
      (select count(*) from private.notification_attempts) +
      (select count(*) from private.onboarding_documents) +
      (select count(*) from private.profile_onboarding_policy) +
      (select count(*) from private.profile_policy_acceptances) +
      (select count(*) from private.analytics_policy) +
      (select count(*) from private.analytics_consents) +
      (select count(*) from private.analytics_events) +
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
    'All ten PostgreSQL multi-session analytics races and source rollback visibility check passed.',
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
