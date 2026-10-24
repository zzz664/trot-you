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
    this.label = `reply-concurrency-${label}`;
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
    const marker = `REPLY_TEST_DONE_${++commandSequence}`;
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
  const fanId = uuid();
  const otherFanId = uuid();
  const artistId = uuid();
  const authorId = uuid();
  const adminId = uuid();
  const termsId = uuid();
  const privacyId = uuid();
  const replacementTermsId = uuid();
  const slug = `reply-race-${artistId}`;
  await db.query(`
    insert into auth.users(id,email,raw_user_meta_data)
      values('${fanId}','reply-race@example.invalid','{}'),
        ('${otherFanId}','reply-race-other@example.invalid','{}'),
        ('${authorId}','reply-race-author@example.invalid','{}'),
        ('${adminId}','reply-race-admin@example.invalid','{}');
    update public.profiles set role='artist' where id='${authorId}';
    update public.profiles set role='admin' where id='${adminId}';
    insert into public.artists(id,slug,name,grade,status)
      values('${artistId}','${slug}','허구 경합 가수','B','active');
    insert into public.artist_members(artist_id,user_id) values('${artistId}','${authorId}');
    insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
      ('${termsId}','terms','Fictional terms','Only a disposable race fixture.',now(),now()),
      ('${privacyId}','privacy','Fictional privacy','Only a disposable race fixture.',now(),now()),
      ('${replacementTermsId}','terms','Fictional changed terms','Only a disposable race fixture.',now(),now());
    insert into private.profile_onboarding_policy values(true,'${uuid()}',now(),2,10,
      array['금지단어'],'${termsId}','${privacyId}',null);
    insert into private.message_policy values(true,'fictional-reply-race',604800,300,1000,100,10,180,60,5,
      10485760,20971520,104857600);
    insert into private.reply_policy values(true,'fictional-reply-race',now(),60,100,array['금지단어'],array['phone','account','url']);
    begin;
      ${authenticated(
        fanId,
        `select public.onboarding_save_font('large');
        select public.onboarding_save_name('허구경합팬');
        select public.onboarding_complete_profile(true,true,'${termsId}',true,'${privacyId}');`,
      )}
      ${authenticated(
        otherFanId,
        `select public.onboarding_save_font('normal');
        select public.onboarding_save_name('허구다른팬');
        select public.onboarding_complete_profile(true,true,'${termsId}',true,'${privacyId}');`,
      )}
    commit;
    update public.profiles set onboarding_completed_at=clock_timestamp() where id in ('${fanId}','${otherFanId}');
    insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end)
      values('${uuid()}','${fanId}','${artistId}','toss','active',now()-interval '1 day',now()-interval '1 day',now()-interval '1 day',now()+interval '29 days'),
      ('${uuid()}','${otherFanId}','${artistId}','toss','active',now()-interval '1 day',now()-interval '1 day',now()-interval '1 day',now()+interval '29 days');
  `);
  return {
    fanId,
    otherFanId,
    artistId,
    authorId,
    adminId,
    termsId,
    replacementTermsId,
    slug,
  };
}

// Create/schedule/dispatch through actual privileged messaging RPCs. The fixture
// uses a fictional paid state only; no provider calls or media bytes.
async function sentMessage(db, f) {
  const id = await db.query(
    `begin; ${service(`select public.messaging_save_draft(
    '${f.authorId}','${f.artistId}',null,'text','허구 경합 인사 {이름}');`)} commit;`,
  );
  await db.query(
    `begin; ${service(`select public.messaging_schedule(
    '${f.authorId}','${id}',statement_timestamp());`)} commit;`,
  );
  assert.equal(
    await db.query(
      `begin; ${service(`select public.messaging_dispatch('${id}');`)} commit;`,
    ),
    't',
  );
  return id;
}

const send = (f, key, body = '허구 답장', messageId = null) =>
  authenticated(
    f.fanId,
    `select to_jsonb(r) from public.fan_reply_send('${f.slug}','${key}','${body}',${messageId ? `'${messageId}'` : 'null'}) r;`,
  );
const page = (f) =>
  authenticated(
    f.fanId,
    `select to_jsonb(p) from public.fan_reply_page('${f.slug}') p;`,
  );
const json = (value) => JSON.parse(value);
const expectError = (result, message) => {
  assert.ok(result.following.error instanceof Error);
  assert.match(result.following.error.message, new RegExp(message));
};
async function testConcurrency(db) {
  const f = await fixture(db);
  const messageId = await sentMessage(db, f);
  const key = uuid();
  const count = () =>
    db.query(`select count(*) from public.replies where user_id='${f.fanId}';`);
  const resetRate = () =>
    db.query(
      `delete from private.reply_rate_limits; update private.reply_policy set rate_max_count=100;`,
    );

  const repeat = await race(db, 'same-operation', send(f, key), send(f, key));
  assert.equal(repeat.following.error, undefined);
  assert.deepEqual(json(repeat.winner), json(repeat.following.value));
  assert.equal(await count(), '1');
  assert.equal(
    await db.query(
      `select count from private.reply_rate_limits where user_id='${f.fanId}';`,
    ),
    '1',
  );
  console.info(
    'PASS: simultaneous same operation has one reply, original timestamp and one quota',
  );

  const conflict = await race(
    db,
    'payload-conflict',
    send(f, key),
    send(f, key, '바뀐 답장'),
  );
  expectError(conflict, 'REPLY_OPERATION_CONFLICT');
  assert.equal(await count(), '1');
  console.info(
    'PASS: waiting changed payload cannot mutate accepted operation',
  );

  await resetRate();
  await db.query('update private.reply_policy set rate_max_count=1;');
  const quota = await race(db, 'last-quota', send(f, uuid()), send(f, uuid()));
  expectError(quota, 'REPLY_RATE_LIMITED');
  assert.equal(await count(), '2');
  console.info(
    'PASS: competing distinct operations cannot overrun last per-user quota',
  );

  await resetRate();
  await db.query('update private.reply_policy set rate_max_count=1;');
  const legacy = await race(
    db,
    'legacy-shared-quota',
    service(
      `select public.messaging_create_reply('${f.fanId}','${f.artistId}','레거시 허구 답장');`,
    ),
    send(f, uuid()),
  );
  expectError(legacy, 'REPLY_RATE_LIMITED');
  assert.equal(await count(), '3');
  console.info(
    'PASS: compatibility service and actor writer share the same quota primitive',
  );

  await resetRate();
  const active = await session('other-fan-active');
  const independent = await session('own-independent');
  try {
    await active.query(`begin; ${send({ ...f, fanId: f.otherFanId }, uuid())}`);
    const own = json(
      await independent.query(`begin; ${send(f, uuid())} commit;`),
    );
    assert.equal(own.body, '허구 답장');
    await active.query('commit;');
  } finally {
    await Promise.all([active.close(), independent.close()]);
  }
  console.info(
    'PASS: another fan uncommitted reply does not block independent actor',
  );

  const currentKey = uuid();
  const ownPage = await race(
    db,
    'send-before-page',
    send(f, currentKey),
    page(f),
  );
  assert.equal(ownPage.following.error, undefined);
  assert.ok(
    json(ownPage.following.value).replies.some(
      (r) => r.operation_id === currentKey,
    ),
  );
  console.info('PASS: page waiting for actor send sees committed own reply');

  const restricted = await race(
    db,
    'restriction-before-send',
    `update public.profiles set is_restricted=true where id='${f.fanId}';`,
    send(f, uuid()),
  );
  expectError(restricted, 'DISCOVERY_FORBIDDEN');
  await db.query(
    `update public.profiles set is_restricted=false where id='${f.fanId}';`,
  );
  console.info(
    'PASS: send waiting for restriction rechecks latest actor state',
  );

  const restrictedPage = await race(
    db,
    'restriction-before-page',
    `update public.profiles set is_restricted=true where id='${f.fanId}';`,
    page(f),
  );
  expectError(restrictedPage, 'DISCOVERY_FORBIDDEN');
  await db.query(
    `update public.profiles set is_restricted=false where id='${f.fanId}';`,
  );
  console.info(
    'PASS: own history waiting for restriction does not expose retained text',
  );

  const expired = await race(
    db,
    'expiry-before-send',
    `update public.subscriptions set current_period_end=clock_timestamp()-interval '1 second' where user_id='${f.fanId}';`,
    send(f, uuid()),
  );
  expectError(expired, 'REPLY_SUBSCRIPTION_REQUIRED');
  await db.query(
    `update public.subscriptions set current_period_end=clock_timestamp()+interval '1 day' where user_id='${f.fanId}';`,
  );
  console.info(
    'PASS: send waiting for subscription expiry cannot create a late reply',
  );

  const cancel = await race(
    db,
    'message-cancel-before-send',
    service(`select public.messaging_cancel('${f.authorId}','${messageId}');`),
    send(f, uuid(), '메시지 답장', messageId),
  );
  expectError(cancel, 'REPLY_MESSAGE_NOT_VISIBLE');
  console.info(
    'PASS: target cancellation winning before reply prevents new bound reply',
  );

  const policy = await race(
    db,
    'policy-before-send',
    "update private.reply_policy set forbidden_terms=array['허구'];",
    send(f, uuid()),
  );
  expectError(policy, 'REPLY_FORBIDDEN_CONTENT');
  await db.query(
    "update private.reply_policy set forbidden_terms=array['금지단어'];",
  );
  console.info(
    'PASS: waiting writer applies latest committed moderation policy',
  );

  const policyRemoved = await race(
    db,
    'policy-remove-before-page',
    'delete from private.reply_policy;',
    page(f),
  );
  assert.equal(policyRemoved.following.error, undefined);
  assert.equal(json(policyRemoved.following.value).send_ready, false);
  assert.ok(json(policyRemoved.following.value).replies.length > 0);
  await db.query(
    "insert into private.reply_policy values(true,'fictional-restored',now(),60,100,array['금지단어'],array['phone','account','url']);",
  );
  console.info(
    'PASS: waiting page retains own history but disables send after policy removal',
  );

  const legal = await race(
    db,
    'legal-before-send',
    `update private.profile_onboarding_policy set terms_version='${f.replacementTermsId}';`,
    send(f, uuid()),
  );
  expectError(legal, 'DISCOVERY_PROFILE_REQUIRED');
  await db.query(
    `update private.profile_onboarding_policy set terms_version='${f.termsId}';`,
  );
  console.info(
    'PASS: waiting send requires newly current consent rather than stale readiness',
  );

  const otherArtist = uuid();
  const otherSlug = `reply-other-${otherArtist}`;
  await db.query(`insert into public.artists(id,slug,name,grade,status) values('${otherArtist}','${otherSlug}','허구 다른 가수','B','active');
    insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end)
    values('${uuid()}','${f.fanId}','${otherArtist}','toss','active',now(),now(),now(),now()+interval '1 day');`);
  const other = { ...f, artistId: otherArtist, slug: otherSlug };
  const artistConflict = await race(
    db,
    'artist-binding',
    send(f, key),
    send(other, key),
  );
  expectError(artistConflict, 'REPLY_OPERATION_CONFLICT');
  console.info(
    'PASS: operation UUID cannot be reused against another subscribed artist',
  );

  await resetRate();
  await db.query('update private.reply_policy set rate_max_count=1;');
  const across = await race(
    db,
    'cross-artist-quota',
    send(f, uuid()),
    send(other, uuid()),
  );
  expectError(across, 'REPLY_RATE_LIMITED');
  console.info(
    'PASS: per-user quota is atomic across two artists, not per-room bypassable',
  );

  assert.equal(
    await db.query('select count(*) from private.point_ledger;'),
    '0',
  );
  assert.equal(
    await db.query(
      "select count(*) from private.analytics_events where name='reply_sent';",
    ),
    '0',
  );
  assert.equal(
    await db.query('select count(*) from public.message_reads;'),
    '0',
  );
}
try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(`select
    (select count(*) from auth.users)+(select count(*) from public.profiles)+
    (select count(*) from public.subscriptions)+(select count(*) from public.payment_events)+
    (select count(*) from public.messages)+(select count(*) from public.replies)+
    (select count(*) from private.reply_policy)+(select count(*) from private.reply_rate_limits)+
    (select count(*) from private.profile_onboarding_policy)+(select count(*) from private.onboarding_documents)+
    (select count(*) from private.profile_policy_acceptances)+(select count(*) from private.message_policy)+
    (select count(*) from public.artists where id not in('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'));`),
    '0',
    'Use a freshly reset disposable local database with fictional seeds only; this test resets it afterward.',
  );
  shouldReset = true;
  await testConcurrency(db);
  console.info(
    'All fifteen PostgreSQL multi-session reply concurrency checks passed.',
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
