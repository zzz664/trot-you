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
    this.label = `messaging-concurrency-${label}`;
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
    const marker = `MESSAGING_TEST_DONE_${++commandSequence}`;
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
  const authorId = uuid();
  const adminId = uuid();
  const artistId = uuid();
  const subscriptionId = uuid();
  await db.query(`
    insert into auth.users(id, email, raw_user_meta_data) values
      ('${fanId}', 'message-concurrency-fan@example.invalid', '{}'),
      ('${authorId}', 'message-concurrency-artist@example.invalid', '{}'),
      ('${adminId}', 'message-concurrency-admin@example.invalid', '{}');
    update public.profiles set call_name = 'Fictional fan',
      onboarding_completed_at = statement_timestamp() where id = '${fanId}';
    update public.profiles set role = 'artist' where id = '${authorId}';
    update public.profiles set role = 'admin' where id = '${adminId}';
    insert into public.artists(id, slug, name, grade, status)
      values ('${artistId}', 'message-concurrency-${artistId}', 'Fictional concurrency artist', 'B', 'active');
    insert into public.artist_members(artist_id, user_id) values ('${artistId}', '${authorId}');
    insert into public.subscriptions(id, user_id, artist_id, provider, status,
      first_started_at, episode_started_at, current_period_start, current_period_end)
      values ('${subscriptionId}', '${fanId}', '${artistId}', 'toss', 'active',
        statement_timestamp() - interval '1 day', statement_timestamp() - interval '1 day',
        statement_timestamp() - interval '1 day', statement_timestamp() + interval '30 days');
    insert into private.message_policy values
      (true, 'fictional-concurrency-policy-v1', 604800, 300, 1000, 100, 10, 180, 60, 5,
        10485760, 20971520, 104857600);
  `);
  return { fanId, authorId, adminId, artistId, subscriptionId };
}

async function message(db, f, sent = true) {
  const id = await db.query(
    `begin; ${service(`select public.messaging_save_draft(
    '${f.authorId}', '${f.artistId}', null, 'text', 'Fictional concurrency message');`)} commit;`,
  );
  await db.query(
    `begin; ${service(`select public.messaging_schedule(
    '${f.authorId}', '${id}', statement_timestamp());`)} commit;`,
  );
  if (sent) {
    assert.equal(
      await db.query(
        `begin; ${service(`select public.messaging_dispatch('${id}');`)} commit;`,
      ),
      't',
    );
  }
  return id;
}

const mark = (f, id) =>
  authenticated(f.fanId, `select public.mark_message_read('${id}');`);
const cancel = (f, id) =>
  service(`select public.messaging_cancel('${f.authorId}', '${id}');`);

async function testConcurrency(db) {
  const f = await fixture(db);

  // 1. A second due-message transition waits for the first and observes sent,
  // rather than returning another successful send transition.
  const scheduled = await message(db, f, false);
  const dispatchSql = service(
    `select public.messaging_dispatch('${scheduled}');`,
  );
  const dispatched = await race(db, 'dispatch', dispatchSql, dispatchSql);
  assert.equal(dispatched.winner, 't');
  assert.equal(dispatched.following.error, undefined);
  assert.equal(dispatched.following.value, 'f');
  assert.equal(
    await db.query(`select count(*) from public.messages
      where id = '${scheduled}' and status = 'sent' and sent_at is not null;`),
    '1',
  );
  console.info(
    'PASS: concurrent dispatch transitions one message exactly once',
  );

  // 2. Cancellation wins: a read RPC that began before the cancellation commit
  // must recheck the newly canceled state after acquiring its authorization locks.
  const canceledMessage = await message(db, f);
  const cancelFirst = await race(
    db,
    'cancel-before-read',
    cancel(f, canceledMessage),
    mark(f, canceledMessage),
  );
  assert.match(
    cancelFirst.following.error?.message ?? '',
    /MESSAGE_NOT_VISIBLE/,
  );
  assert.equal(
    await db.query(`select count(*) from public.message_reads
      where message_id = '${canceledMessage}';`),
    '0',
  );
  console.info(
    'PASS: cancellation winning the lock prevents a new read receipt',
  );

  // 3. Read wins: cancellation waits for the authorized receipt, then hides the
  // message without deleting historical refund/read evidence.
  const readMessage = await message(db, f);
  const readFirst = await race(
    db,
    'read-before-cancel',
    mark(f, readMessage),
    cancel(f, readMessage),
  );
  assert.ok(readFirst.winner.length > 0);
  assert.equal(readFirst.following.error, undefined);
  assert.equal(
    await db.query(`select count(*) from public.message_reads r
      join public.messages m on m.id = r.message_id
      where r.message_id = '${readMessage}' and r.user_id = '${f.fanId}'
        and r.read_at <= m.canceled_at and m.status = 'canceled';`),
    '1',
  );
  console.info(
    'PASS: read-before-cancel retains exactly one historical receipt',
  );

  // 4. Artist-level serialization means a preview replacement is a whole list,
  // not the union/interleaving of two admin submissions or a lock-upgrade deadlock.
  const previewIds = [];
  for (let index = 0; index < 4; index++) {
    previewIds.push(await message(db, f));
  }
  const previewSql = (ids) =>
    service(`select public.messaging_set_previews('${f.adminId}', '${f.artistId}',
      array[${ids.map((id) => `'${id}'::uuid`).join(',')}]);`);
  const previewRace = await race(
    db,
    'preview-replace',
    previewSql(previewIds.slice(0, 2)),
    previewSql(previewIds.slice(2)),
  );
  assert.equal(previewRace.following.error, undefined);
  assert.deepEqual(
    JSON.parse(
      await db.query(`select jsonb_agg(id order by preview_order) from public.messages
        where artist_id = '${f.artistId}' and is_preview;`),
    ),
    previewIds.slice(2),
  );
  console.info('PASS: competing preview replacements serialize as whole lists');

  // 5. The waiting read starts before paid access expires. A fresh clock after
  // subscription lock acquisition must deny it after the exclusive end boundary.
  const expiringMessage = await message(db, f);
  const paidEnd = await db.query(`update public.subscriptions
    set current_period_end = statement_timestamp() + interval '3 seconds'
    where id = '${f.subscriptionId}' returning current_period_end;`);
  const expired = await race(
    db,
    'read-access-expiry',
    `select id from public.subscriptions where id = '${f.subscriptionId}' for update;`,
    mark(f, expiringMessage),
    async (waiting) => {
      assert.equal(
        await db.query(`select query_start < '${paidEnd}'::timestamptz
          from pg_stat_activity where application_name = '${waiting.label}';`),
        't',
        'The blocked read statement must actually start before access expires.',
      );
      await db.query(`select pg_sleep(greatest(0, extract(epoch from
        '${paidEnd}'::timestamptz - clock_timestamp())) + 0.05);`);
    },
  );
  assert.match(expired.following.error?.message ?? '', /MESSAGE_NOT_VISIBLE/);
  assert.equal(
    await db.query(`select count(*) from public.message_reads
      where message_id = '${expiringMessage}';`),
    '0',
  );
  console.info(
    'PASS: read blocked past paid access expiry cannot create receipt',
  );
}

try {
  assertLocalDocker();
  const db = await session('observer');
  // Refuse user data before authorizing fixture writes or the teardown reset.
  // message-media bucket configuration is a migration, not a user data row.
  assert.equal(
    await db.query(`select
      (select count(*) from auth.users) +
      (select count(*) from public.profiles) +
      (select count(*) from public.subscriptions) +
      (select count(*) from public.payment_events) +
      (select count(*) from public.messages) +
      (select count(*) from public.message_media) +
      (select count(*) from public.message_reads) +
      (select count(*) from public.replies) +
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
    'All five PostgreSQL multi-session messaging concurrency checks passed.',
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
