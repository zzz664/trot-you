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
    this.label = `chat-concurrency-${label}`;
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
    const marker = `CHAT_TEST_DONE_${++commandSequence}`;
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
  const slug = `chat-race-${artistId}`;
  await db.query(`
    insert into auth.users(id,email,raw_user_meta_data)
      values('${fanId}','chat-race@example.invalid','{}'),
        ('${otherFanId}','chat-race-other@example.invalid','{}'),
        ('${authorId}','chat-race-author@example.invalid','{}'),
        ('${adminId}','chat-race-admin@example.invalid','{}');
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
    insert into private.message_policy values(true,'fictional-chat-race',604800,300,1000,100,10,180,60,5,
      10485760,20971520,104857600);
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

const read = (f, id) =>
  authenticated(
    f.fanId,
    `select to_jsonb(r) from public.fan_chat_mark_read('${f.slug}','${id}') r;`,
  );
const page = (f) =>
  service(
    `select to_jsonb(p) from public.fan_chat_page('${f.fanId}','${f.slug}') p;`,
  );
const json = (value) => JSON.parse(value);

async function testConcurrency(db) {
  const f = await fixture(db);
  const firstId = await sentMessage(db, f);
  const secondId = await sentMessage(db, f);
  const thirdId = await sentMessage(db, f);
  const countReads = () =>
    db.query(
      `select count(*) from public.message_reads where user_id='${f.fanId}';`,
    );

  const repeat = await race(
    db,
    'duplicate-read',
    read(f, firstId),
    read(f, firstId),
  );
  assert.equal(repeat.following.error, undefined);
  assert.deepEqual(json(repeat.winner), json(repeat.following.value));
  assert.equal(json(repeat.winner).read_count, 1);
  assert.equal(await countReads(), '1');
  console.info(
    'PASS: two simultaneous identical reads retain one timestamp and one count',
  );

  const distinct = await race(
    db,
    'distinct-reads',
    read(f, secondId),
    read(f, thirdId),
  );
  assert.equal(distinct.following.error, undefined);
  assert.equal(json(distinct.winner).read_count, 2);
  assert.equal(json(distinct.following.value).read_count, 3);
  assert.equal(await countReads(), '3');
  console.info(
    'PASS: two different simultaneous reads serialize authoritative actor counts',
  );

  // Keep the second fan's actual receipt transaction uncommitted while the
  // first fan reads the same message. A needless message FOR SHARE would wait
  // for this write and fail the statement timeout; successful completion before
  // COMMIT proves the page remains independent without a timing-only sleep.
  const otherRead = await session('other-fan-read-uncommitted');
  const ownPage = await session('own-page-no-message-lock');
  try {
    const other = json(
      await otherRead.query(
        `begin; ${read({ ...f, fanId: f.otherFanId }, firstId)}`,
      ),
    );
    assert.equal(other.read_count, 1);
    const snapshot = json(await ownPage.query(`begin; ${page(f)} commit;`));
    assert.equal(snapshot.read_count, 3);
    assert.equal(
      snapshot.messages.find((message) => message.id === firstId)?.read_at,
      json(repeat.winner).read_at,
    );
    assert.equal(
      await db.query(
        `select count(*) from public.message_reads where user_id='${f.otherFanId}';`,
      ),
      '0',
      'other fan receipt is still uncommitted when page completes',
    );
    await otherRead.query('commit;');
    assert.equal(await countReads(), '3');
  } finally {
    await Promise.all([otherRead.close(), ownPage.close()]);
  }
  console.info(
    'PASS: page completes while another fan holds the same message read lock, retaining its own receipt snapshot',
  );

  const canceledId = await sentMessage(db, f);
  const cancelFirst = await race(
    db,
    'cancel-before-read',
    service(`select public.messaging_cancel('${f.authorId}','${canceledId}');`),
    read(f, canceledId),
  );
  assert.match(
    cancelFirst.following.error?.message ?? '',
    /MESSAGE_NOT_VISIBLE/,
  );
  assert.equal(await countReads(), '3');
  console.info(
    'PASS: a read waiting for actual cancellation creates no reading evidence',
  );

  const readFirstId = await sentMessage(db, f);
  const readFirst = await race(
    db,
    'read-before-cancel',
    read(f, readFirstId),
    service(
      `select public.messaging_cancel('${f.authorId}','${readFirstId}');`,
    ),
  );
  assert.equal(readFirst.following.error, undefined);
  assert.equal(json(readFirst.winner).read_count, 4);
  assert.equal(await countReads(), '4');
  const afterCancel = json(await db.query(`begin; ${page(f)} commit;`));
  assert.equal(afterCancel.read_count, 3);
  assert.ok(!afterCancel.messages.some((m) => m.id === readFirstId));
  console.info(
    'PASS: read-before-cancel retains evidence while removing visible content and count',
  );

  const restricted = await race(
    db,
    'restriction-before-read',
    `update public.profiles set is_restricted=true where id='${f.fanId}';`,
    read(f, firstId),
  );
  assert.match(
    restricted.following.error?.message ?? '',
    /DISCOVERY_FORBIDDEN/,
  );
  assert.equal(await countReads(), '4');
  await db.query(
    `update public.profiles set is_restricted=false where id='${f.fanId}';`,
  );
  console.info(
    'PASS: read waiting for actor restriction revalidates current eligibility',
  );

  const role = await race(
    db,
    'role-before-page',
    `update public.profiles set role='artist' where id='${f.fanId}';`,
    page(f),
  );
  assert.match(role.following.error?.message ?? '', /DISCOVERY_FORBIDDEN/);
  await db.query(
    `update public.profiles set role='fan' where id='${f.fanId}';`,
  );
  console.info(
    'PASS: page waiting for a role change cannot retain obsolete fan permissions',
  );

  const expired = await race(
    db,
    'expiry-before-page',
    `update public.subscriptions set current_period_end=clock_timestamp()-interval '1 second' where user_id='${f.fanId}';`,
    page(f),
  );
  assert.equal(expired.following.error, undefined);
  assert.equal(json(expired.following.value).has_access, false);
  assert.deepEqual(json(expired.following.value).messages, []);
  assert.equal(json(expired.following.value).read_count, 0);
  await db.query(
    `update public.subscriptions set current_period_end=clock_timestamp()+interval '29 days' where user_id='${f.fanId}';`,
  );
  console.info(
    'PASS: page waiting for paid expiry returns gated context without paid data',
  );

  const expiredRead = await race(
    db,
    'expiry-before-read',
    `update public.subscriptions set current_period_end=clock_timestamp()-interval '1 second' where user_id='${f.fanId}';`,
    read(f, firstId),
  );
  assert.match(
    expiredRead.following.error?.message ?? '',
    /MESSAGE_NOT_VISIBLE/,
  );
  await db.query(
    `update public.subscriptions set current_period_end=clock_timestamp()+interval '29 days' where user_id='${f.fanId}';`,
  );
  console.info(
    'PASS: read replay waiting for paid expiry creates no new receipt',
  );

  const rotated = await race(
    db,
    'policy-before-read',
    `update private.profile_onboarding_policy set terms_version='${f.replacementTermsId}';`,
    read(f, firstId),
  );
  assert.match(
    rotated.following.error?.message ?? '',
    /DISCOVERY_PROFILE_REQUIRED/,
  );
  await db.query(
    `update private.profile_onboarding_policy set terms_version='${f.termsId}';`,
  );
  console.info(
    'PASS: read waiting for current legal policy rotation requires current consent',
  );

  const paused = await race(
    db,
    'pause-before-page',
    `update public.artists set status='paused' where id='${f.artistId}';`,
    page(f),
  );
  assert.match(paused.following.error?.message ?? '', /CHAT_NOT_FOUND/);
  await db.query(
    `update public.artists set status='active' where id='${f.artistId}';`,
  );
  console.info(
    'PASS: page waiting for artist pause does not expose artist context',
  );

  const beforeCancel = await sentMessage(db, f);
  const cancelPage = await race(
    db,
    'cancel-before-page',
    service(
      `select public.messaging_cancel('${f.authorId}','${beforeCancel}');`,
    ),
    page(f),
  );
  assert.equal(cancelPage.following.error, undefined);
  assert.ok(
    !json(cancelPage.following.value).messages.some(
      (m) => m.id === beforeCancel,
    ),
  );
  console.info(
    'PASS: page waiting for real message cancellation returns post-cancellation content',
  );

  await db.query(
    `update public.subscriptions set episode_started_at=clock_timestamp() where user_id='${f.fanId}';`,
  );
  const history = await race(
    db,
    'history-policy-before-page',
    'update private.message_policy set history_before_seconds=0;',
    page(f),
  );
  assert.equal(history.following.error, undefined);
  assert.deepEqual(json(history.following.value).messages, []);
  assert.equal(json(history.following.value).read_count, 0);
  assert.equal(await countReads(), '4');
  console.info(
    'PASS: history policy changed while page waits is applied without erasing evidence',
  );
}
try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(`select
      (select count(*) from auth.users) +
      (select count(*) from public.profiles) +
      (select count(*) from public.subscriptions) +
      (select count(*) from public.payment_events) +
      (select count(*) from public.messages) +
      (select count(*) from public.message_media) +
      (select count(*) from private.artist_interests) +
      (select count(*) from private.profile_onboarding_policy) +
      (select count(*) from private.onboarding_documents) +
      (select count(*) from private.profile_policy_acceptances) +
      (select count(*) from private.message_policy) +
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
    'All thirteen PostgreSQL multi-session chat concurrency checks passed.',
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
