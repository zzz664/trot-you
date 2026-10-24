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
    this.label = `onboarding-concurrency-${label}`;
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
    const marker = `ONBOARDING_TEST_DONE_${++commandSequence}`;
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
  const artistId = uuid();
  const termsId = uuid();
  const privacyId = uuid();
  const replacementTermsId = uuid();
  const slug = `onboarding-race-${artistId}`;
  await db.query(`
    insert into auth.users(id,email,raw_user_meta_data)
      values('${fanId}','onboarding-race@example.invalid','{}');
    insert into public.artists(id,slug,name,grade,status)
      values('${artistId}','${slug}','허구 가입 경합 가수','B','active');
    insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
      ('${termsId}','terms','Fictional terms','Only a disposable race fixture.',now(),now()),
      ('${privacyId}','privacy','Fictional privacy','Only a disposable race fixture.',now(),now()),
      ('${replacementTermsId}','terms','Fictional changed terms','Only a disposable race fixture.',now(),now());
    insert into private.profile_onboarding_policy values(true,'${uuid()}',now(),2,10,
      array['금지단어'],'${termsId}','${privacyId}',null);
    begin;
      ${authenticated(
        fanId,
        `select public.onboarding_save_font('large');
        select public.onboarding_save_name('허구가입팬');
        select public.onboarding_complete_profile(true,true,'${termsId}',true,'${privacyId}');
        select public.discovery_select_artist('${slug}');
        select public.onboarding_acknowledge_install('skipped');`,
      )}
    commit;
  `);
  return { fanId, artistId, termsId, privacyId, replacementTermsId, slug };
}

async function testConcurrency(db) {
  const f = await fixture(db);
  const complete = authenticated(
    f.fanId,
    'select public.onboarding_complete();',
  );
  const unchanged = async () => {
    assert.equal(
      await db.query(`select onboarding_completed_at is null
        from public.profiles where id='${f.fanId}';`),
      't',
    );
    assert.equal(
      await db.query(`select count(*) from private.onboarding_install_guidance
        where user_id='${f.fanId}' and choice='skipped' and installation_self_reported_at is null;`),
      '1',
    );
  };

  const paused = await race(
    db,
    'pause-before-finish',
    `update public.artists set status='paused' where id='${f.artistId}';`,
    complete,
  );
  assert.match(
    paused.following.error?.message ?? '',
    /ONBOARDING_ARTIST_REQUIRED/,
  );
  await unchanged();
  console.info('PASS: finish waits for artist deactivation and fails closed');
  await db.query(
    `update public.artists set status='active' where id='${f.artistId}';`,
  );

  const revoked = await race(
    db,
    'interest-withdrawal-before-finish',
    `delete from private.artist_interests where user_id='${f.fanId}';`,
    complete,
  );
  assert.match(
    revoked.following.error?.message ?? '',
    /ONBOARDING_ARTIST_REQUIRED/,
  );
  await unchanged();
  console.info(
    'PASS: finish waits for selected-interest withdrawal and fails closed',
  );
  await db.query(
    `begin; ${authenticated(f.fanId, `select public.discovery_select_artist('${f.slug}');`)} commit;`,
  );

  const policy = await race(
    db,
    'policy-before-finish',
    `update private.profile_onboarding_policy set terms_version='${f.replacementTermsId}';`,
    complete,
  );
  assert.match(
    policy.following.error?.message ?? '',
    /DISCOVERY_PROFILE_REQUIRED/,
  );
  await unchanged();
  console.info(
    'PASS: finish waiting behind legal policy rotation requires current consent',
  );
  await db.query(
    `update private.profile_onboarding_policy set terms_version='${f.termsId}';`,
  );

  const name = await race(
    db,
    'name-policy-before-finish',
    `update private.profile_onboarding_policy set profanity_words=array['허구가입팬'];`,
    complete,
  );
  assert.match(
    name.following.error?.message ?? '',
    /DISCOVERY_PROFILE_REQUIRED/,
  );
  await unchanged();
  console.info(
    'PASS: finish waiting behind calling-name policy rotation revalidates the saved name',
  );
  await db.query(
    `update private.profile_onboarding_policy set profanity_words=array['금지단어'];`,
  );

  const acceptance = await race(
    db,
    'acceptance-withdrawal-before-finish',
    `delete from private.profile_policy_acceptances where user_id='${f.fanId}' and kind='terms';`,
    complete,
  );
  assert.match(
    acceptance.following.error?.message ?? '',
    /DISCOVERY_PROFILE_REQUIRED/,
  );
  await unchanged();
  console.info(
    'PASS: finish locks exact current consent evidence and fails after a winning withdrawal',
  );
  await db.query(
    `begin; ${authenticated(
      f.fanId,
      `select public.onboarding_complete_profile(true,true,'${f.termsId}',true,'${f.privacyId}');`,
    )} commit;`,
  );

  const restricted = await race(
    db,
    'restriction-before-finish',
    `update public.profiles set is_restricted=true where id='${f.fanId}';`,
    complete,
  );
  assert.match(
    restricted.following.error?.message ?? '',
    /DISCOVERY_FORBIDDEN/,
  );
  await unchanged();
  console.info('PASS: finish waiting behind actor restriction is denied');
  await db.query(
    `update public.profiles set is_restricted=false where id='${f.fanId}';`,
  );

  const guidance = await race(
    db,
    'guidance-withdrawal-before-finish',
    `delete from private.onboarding_install_guidance where user_id='${f.fanId}';`,
    complete,
  );
  assert.match(
    guidance.following.error?.message ?? '',
    /ONBOARDING_INSTALL_REQUIRED/,
  );
  assert.equal(
    await db.query(
      `select onboarding_completed_at is null from public.profiles where id='${f.fanId}';`,
    ),
    't',
  );
  console.info(
    'PASS: finish waits for guidance withdrawal rather than using stale evidence',
  );

  const acknowledgment = await race(
    db,
    'acknowledge-before-finish',
    authenticated(
      f.fanId,
      `select public.onboarding_acknowledge_install('skipped');`,
    ),
    complete,
  );
  assert.equal(acknowledgment.following.error, undefined);
  const firstStamp = acknowledgment.following.value;
  assert.ok(firstStamp);
  assert.equal(
    await db.query(
      `select onboarding_completed_at from public.profiles where id='${f.fanId}';`,
    ),
    firstStamp,
  );
  console.info(
    'PASS: finish waits for explicit guidance acknowledgment and completes without any installation or permission claim',
  );

  const repeat = await race(db, 'repeated-finish', complete, complete);
  assert.equal(repeat.following.error, undefined);
  assert.equal(repeat.winner, firstStamp);
  assert.equal(repeat.following.value, firstStamp);
  console.info(
    'PASS: simultaneous finish retries preserve exactly the same completion timestamp',
  );

  const completedFirst = await race(
    db,
    'finish-before-interest-withdrawal',
    complete,
    `delete from private.artist_interests where user_id='${f.fanId}';`,
  );
  assert.equal(completedFirst.winner, firstStamp);
  assert.equal(completedFirst.following.error, undefined);
  assert.equal(
    await db.query(
      `select onboarding_completed_at from public.profiles where id='${f.fanId}';`,
    ),
    firstStamp,
  );
  // A new retry observes the completed withdrawal, not merely the old timestamp.
  const retry = await session('retry-after-withdrawal');
  try {
    await assert.rejects(
      retry.query(`begin; ${complete} commit;`),
      /ONBOARDING_ARTIST_REQUIRED/,
    );
  } finally {
    await retry.close();
  }
  console.info(
    'PASS: finish holds the interest lock through commit and subsequent retries recheck withdrawal',
  );

  assert.equal(
    await db.query(
      `select count(*) from public.subscriptions where user_id='${f.fanId}';`,
    ),
    '0',
  );
  assert.equal(
    await db.query('select count(*) from private.analytics_events;'),
    '0',
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
      (select count(*) from private.artist_interests) +
      (select count(*) from private.onboarding_install_guidance) +
      (select count(*) from private.profile_onboarding_policy) +
      (select count(*) from private.onboarding_documents) +
      (select count(*) from private.profile_policy_acceptances) +
      (select count(*) from public.artists where id not in (
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002'));`),
    '0',
    'Use a freshly reset disposable local database with fictional seeds only; this test resets it afterward.',
  );
  shouldReset = true;
  await testConcurrency(db);
  console.info(
    'All ten PostgreSQL multi-session onboarding concurrency checks passed.',
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
