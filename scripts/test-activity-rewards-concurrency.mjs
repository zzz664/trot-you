import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { activityLockQuery } from './activity-race-observer.mjs';

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
let completedCases = 0;
const expectedCases = 18;

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
    this.label = `activity-rewards-concurrency-${label}`;
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
    const marker = `ACTIVITY_REWARDS_TEST_DONE_${++commandSequence}`;
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
    const result = await observer.query(
      activityLockQuery(waiting.pid, blocking.pid),
    );
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
async function race(
  db,
  label,
  firstSql,
  secondSql,
  onBlocked,
  finalize = 'commit',
) {
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
    assert.ok(finalize === 'commit' || finalize === 'rollback');
    await first.query(`${finalize};`);
    const result = { winner, following: await following };
    completedCases += 1;
    return result;
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
}

function value(result) {
  assert.equal(result.following.error, undefined);
  return result.following.value;
}
function expectedError(result, message) {
  assert.ok(result.following.error, `expected ${message}`);
  assert.match(String(result.following.error), new RegExp(message));
  assert.doesNotMatch(
    String(result.following.error),
    /deadlock detected|lock timeout|statement timeout/,
  );
}

const committed = (db, sql) => db.query(`begin; ${sql} commit;`);
const createPost = (f, id = uuid(), operation = uuid()) =>
  authenticated(
    f.fan,
    `select public.board_ui_create('${f.slug}','${operation}','${id}','${f.artist}','Fictional activity post','Fictional activity body','{}'::uuid[],false,false);`,
  );
const createComment = (f, id = uuid(), operation = uuid()) =>
  authenticated(
    f.fan,
    `select public.community_ui_create_comment('${f.slug}','${operation}','${f.post}','${id}','Fictional activity comment');`,
  );
const correction = (f, amount) =>
  authenticated(
    f.admin,
    `select public.point_admin_adjust('${f.fan}',gen_random_uuid(),${amount},'Fictional activity correction');`,
  );
async function fixtures(db) {
  const f = {
    fan: uuid(),
    other: uuid(),
    admin: uuid(),
    artist: uuid(),
    post: uuid(),
  };
  f.slug = `activity-rewards-race-${f.artist}`;
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values
    ('${f.fan}','${f.fan}@example.invalid','{}'),('${f.other}','${f.other}@example.invalid','{}'),('${f.admin}','${f.admin}@example.invalid','{}');
    update public.profiles set call_name='가상활동팬',onboarding_completed_at=clock_timestamp() where id in('${f.fan}','${f.other}','${f.admin}');
    update public.profiles set role='admin' where id='${f.admin}';
    insert into public.artists(id,slug,name,grade,status) values('${f.artist}','${f.slug}','Fictional activity race artist','B','active');
    insert into private.community_policy(singleton,version,max_title_length,max_body_length,max_comment_length,max_reason_length,
      max_images,max_image_bytes,max_image_long_edge,auto_hide_report_count,rate_window_seconds,max_contributions_per_window,
      max_reports_per_window,forbidden_terms,forbidden_patterns)
    values(true,'fictional-activity-race',100,1000,100,100,3,1048576,4096,3,60,1000,1000,'{}','{}')
    on conflict(singleton) do update set max_contributions_per_window=1000;
    insert into private.point_policy(singleton,version,attendance_amount,post_amount,comment_amount,post_daily_cap,comment_daily_cap,deleted_content_treatment)
    values(true,'fictional-activity-race',10,20,5,1,1,'retain')
    on conflict(singleton) do update set version='fictional-activity-race',attendance_amount=10,post_amount=20,comment_amount=5,post_daily_cap=1,comment_daily_cap=1;
    begin; ${authenticated(f.other, `select public.board_ui_create('${f.slug}',gen_random_uuid(),'${f.post}','${f.artist}','Fictional parent post','Fictional parent body','{}'::uuid[],false,false);`)} commit;`);
  return f;
}
async function state(db, f) {
  return JSON.parse(
    await db.query(`select jsonb_build_object(
    'posts',(select count(*) from public.posts where user_id='${f.fan}'),
    'comments',(select count(*) from public.comments where user_id='${f.fan}'),
    'parent_count',(select comment_count from public.posts where id='${f.post}'),
    'operations',(select count(*) from private.board_operations where actor_id='${f.fan}'),
    'entries',(select count(*) from private.point_ledger where user_id='${f.fan}'),
    'balance',(select coalesce(sum(amount),0) from private.point_ledger where user_id='${f.fan}'),
    'amounts',(select coalesce(jsonb_agg(amount order by amount),'[]') from private.point_ledger where user_id='${f.fan}'));`),
  );
}
async function assertOutcomes(db, f, expected) {
  assert.deepEqual(
    JSON.parse(
      await db.query(`select jsonb_build_object(
    'ledger_count',count(*),'outcome_count',count(o.entry_id),
    'outcomes',coalesce(jsonb_agg(o.outcome order by o.outcome),'[]'),
    'orphaned',(select count(*) from private.point_activity_outcomes x left join private.point_ledger p on p.id=x.entry_id where p.id is null))
    from private.point_ledger l left join private.point_activity_outcomes o on o.entry_id=l.id
    where l.user_id='${f.fan}' and l.reason in('post','comment');`),
    ),
    {
      ledger_count: expected.length,
      outcome_count: expected.length,
      outcomes: [...expected].sort(),
      orphaned: 0,
    },
  );
}
const activity = (f) =>
  authenticated(f.fan, 'select public.point_ui_activity();');
async function run(db) {
  for (const kind of ['post', 'comment']) {
    const f = await fixtures(db);
    const sql = kind === 'post' ? createPost(f) : createComment(f);
    const result = await race(db, `duplicate-${kind}-operation`, sql, sql);
    assert.deepEqual(JSON.parse(value(result)), JSON.parse(result.winner));
    assert.deepEqual(await state(db, f), {
      posts: kind === 'post' ? 1 : 0,
      comments: kind === 'comment' ? 1 : 0,
      parent_count: kind === 'comment' ? 1 : 0,
      operations: 1,
      entries: 1,
      balance: kind === 'post' ? 20 : 5,
      amounts: [kind === 'post' ? 20 : 5],
    });
    await assertOutcomes(db, f, ['awarded']);
    console.info(
      `PASS: duplicate ${kind} operation atomically keeps one source, receipt and reward`,
    );
  }
  for (const kind of ['post', 'comment']) {
    const f = await fixtures(db);
    const create = kind === 'post' ? createPost : createComment;
    const result = await race(db, `${kind}-daily-cap`, create(f), create(f));
    assert.notEqual(JSON.parse(value(result)).id, JSON.parse(result.winner).id);
    assert.deepEqual(await state(db, f), {
      posts: kind === 'post' ? 2 : 0,
      comments: kind === 'comment' ? 2 : 0,
      parent_count: kind === 'comment' ? 2 : 0,
      operations: 2,
      entries: 2,
      balance: kind === 'post' ? 20 : 5,
      amounts: [0, kind === 'post' ? 20 : 5],
    });
    assert.deepEqual(
      JSON.parse(
        await db.query(`select jsonb_agg(o.outcome order by l.amount)
      from private.point_ledger l join private.point_activity_outcomes o on o.entry_id=l.id where l.user_id='${f.fan}';`),
      ),
      ['daily_cap', 'awarded'],
    );
    await assertOutcomes(db, f, ['daily_cap', 'awarded']);
    console.info(
      `PASS: concurrent ${kind}s share one explicit daily reward slot while preserving both sources`,
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'independent-action-caps',
      createPost(f),
      createComment(f),
    );
    value(result);
    assert.deepEqual(await state(db, f), {
      posts: 1,
      comments: 1,
      parent_count: 1,
      operations: 2,
      entries: 2,
      balance: 25,
      amounts: [5, 20],
    });
    console.info(
      'PASS: post and comment caps remain separate under one actor lock',
    );
  }
  for (const kind of ['post', 'comment']) {
    const f = await fixtures(db);
    const sql = kind === 'post' ? createPost(f) : createComment(f);
    const result = await race(
      db,
      `${kind}-rollback-before-retry`,
      sql,
      sql,
      undefined,
      'rollback',
    );
    value(result);
    assert.deepEqual(await state(db, f), {
      posts: kind === 'post' ? 1 : 0,
      comments: kind === 'comment' ? 1 : 0,
      parent_count: kind === 'comment' ? 1 : 0,
      operations: 1,
      entries: 1,
      balance: kind === 'post' ? 20 : 5,
      amounts: [kind === 'post' ? 20 : 5],
    });
    await assertOutcomes(db, f, ['awarded']);
    console.info(
      `PASS: rollback removes the ${kind}, award, counter and operation before waiting retry`,
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'policy-deleted-before-post',
      'delete from private.point_policy;',
      createPost(f),
    );
    value(result);
    assert.deepEqual(await state(db, f), {
      posts: 1,
      comments: 0,
      parent_count: 0,
      operations: 1,
      entries: 0,
      balance: 0,
      amounts: [],
    });
    await assertOutcomes(db, f, []);
    console.info(
      'PASS: concurrent policy deletion permits content but never invents a reward',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'policy-changed-before-comment',
      "update private.point_policy set comment_amount=19,comment_daily_cap=0,version='fictional-changed-cap';",
      createComment(f),
    );
    value(result);
    assert.deepEqual(await state(db, f), {
      posts: 0,
      comments: 1,
      parent_count: 1,
      operations: 1,
      entries: 1,
      balance: 0,
      amounts: [0],
    });
    const entry = JSON.parse(
      await db.query(
        `select jsonb_build_object('version',policy_version,'amount',policy_snapshot->'comment_amount','cap',policy_snapshot->'comment_daily_cap') from private.point_ledger where user_id='${f.fan}';`,
      ),
    );
    assert.deepEqual(entry, {
      version: 'fictional-changed-cap',
      amount: 19,
      cap: 0,
    });
    console.info(
      'PASS: award snapshots the committed policy and zero cap after its actual row-lock wait',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'restriction-before-post',
      `update public.profiles set is_restricted=true where id='${f.fan}';`,
      createPost(f),
    );
    expectedError(result, 'COMMUNITY_FORBIDDEN');
    assert.deepEqual(await state(db, f), {
      posts: 0,
      comments: 0,
      parent_count: 0,
      operations: 0,
      entries: 0,
      balance: 0,
      amounts: [],
    });
    console.info(
      'PASS: post and reward fail together after current restriction wins the actor lock',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'hidden-parent-before-comment',
      authenticated(
        f.admin,
        `select public.community_moderate('post','${f.post}','hide','Fictional moderation race');`,
      ),
      createComment(f),
    );
    expectedError(result, 'COMMUNITY_TARGET_UNAVAILABLE');
    assert.deepEqual(await state(db, f), {
      posts: 0,
      comments: 0,
      parent_count: 0,
      operations: 0,
      entries: 0,
      balance: 0,
      amounts: [],
    });
    console.info(
      'PASS: hidden parent cannot gain a waiting comment, counter, receipt or reward',
    );
  }
  for (const kind of ['post', 'comment']) {
    const f = await fixtures(db);
    const result = await race(
      db,
      `balance-limit-before-${kind}`,
      correction(f, 9007199254740991),
      kind === 'post' ? createPost(f) : createComment(f),
    );
    expectedError(result, 'POINT_BALANCE_OUT_OF_RANGE');
    assert.deepEqual(await state(db, f), {
      posts: 0,
      comments: 0,
      parent_count: 0,
      operations: 0,
      entries: 1,
      balance: 9007199254740991,
      amounts: [9007199254740991],
    });
    assert.equal(
      await db.query(
        `select count(*) from private.community_rate_limits where user_id='${f.fan}';`,
      ),
      '0',
    );
    await assertOutcomes(db, f, []);
    console.info(
      `PASS: ledger overflow rolls the entire ${kind}, counter, receipt and rate claim back`,
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'post-before-activity',
      createPost(f),
      activity(f),
    );
    const page = JSON.parse(value(result));
    assert.equal(page.actor_id, f.fan);
    assert.equal(page.entries.length, 1);
    assert.equal(page.entries[0].amount, 20);
    assert.equal(page.entries[0].outcome, 'awarded');
    assert.deepEqual(page.contribution_policy.post, {
      amount: 20,
      daily_cap: 1,
      used: 1,
      awarded: 1,
      remaining: 0,
    });
    console.info(
      'PASS: waiting activity snapshot sees committed source reward, immutable outcome and cap use together',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'activity-before-comment',
      activity(f),
      createComment(f),
    );
    const page = JSON.parse(result.winner);
    assert.deepEqual(page.entries, []);
    assert.deepEqual(page.contribution_policy.comment, {
      amount: 5,
      daily_cap: 1,
      used: 0,
      awarded: 0,
      remaining: 1,
    });
    value(result);
    assert.equal((await state(db, f)).balance, 5);
    console.info(
      'PASS: private activity SHARE lock prevents source reward from interleaving its snapshot',
    );
  }
  {
    const f = await fixtures(db);
    const result = await race(
      db,
      'policy-update-before-activity',
      "update private.point_policy set post_amount=37,post_daily_cap=null,version='fictional-new-activity';",
      activity(f),
    );
    const page = JSON.parse(value(result));
    assert.equal(page.contribution_policy.version, 'fictional-new-activity');
    assert.deepEqual(page.contribution_policy.post, {
      amount: 37,
      daily_cap: null,
      used: 0,
      awarded: 0,
      remaining: null,
    });
    console.info(
      'PASS: private activity sees exact committed policy after configuration lock wait',
    );
  }
  {
    const f = await fixtures(db);
    await committed(db, createPost(f));
    const result = await race(
      db,
      'policy-delete-before-activity',
      'delete from private.point_policy;',
      activity(f),
    );
    const page = JSON.parse(value(result));
    assert.equal(page.contribution_policy, null);
    assert.equal(page.entries.length, 1);
    assert.equal(page.entries[0].amount, 20);
    assert.equal(page.entries[0].outcome, 'awarded');
    console.info(
      'PASS: removing current policy hides unapproved amounts without hiding retained private rewards',
    );
  }
  {
    const f = await fixtures(db);
    await committed(db, createPost(f));
    const result = await race(
      db,
      'restriction-before-activity',
      `update public.profiles set is_restricted=true where id='${f.fan}';`,
      activity(f),
    );
    expectedError(result, 'COMMUNITY_FORBIDDEN');
    assert.equal((await state(db, f)).balance, 20);
    console.info(
      'PASS: waiting activity projection cannot disclose history after restriction wins its lock',
    );
  }
}
try {
  assertLocalDocker();
  const db = await session('observer');
  assert.equal(
    await db.query(
      `select (select count(*) from auth.users)+(select count(*) from private.point_policy)+(select count(*) from private.point_ledger)+(select count(*) from private.point_activity_outcomes);`,
    ),
    '0',
    'Use freshly reset disposable local database; this script restores it afterward.',
  );
  shouldReset = true;
  const startedAt = performance.now();
  await run(db);
  assert.equal(
    await db.query(`select count(*) from private.point_ledger l left join private.point_activity_outcomes o on o.entry_id=l.id
    where l.reason in('post','comment') and o.entry_id is null;`),
    '0',
    'Every committed new contribution has exactly one immutable outcome, including fictional parent fixtures.',
  );
  assert.equal(
    completedCases,
    expectedCases,
    'Every declared activity reward race executed.',
  );
  console.info(
    `All ${completedCases} activity rewards PostgreSQL independent-session races passed in ${Math.round(performance.now() - startedAt)}ms.`,
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.all([...clients].map((client) => client.close()));
  if (shouldReset) {
    try {
      execFileSync(localCli, ['db', 'reset', '--local'], { stdio: 'inherit' });
    } catch (error) {
      console.error(
        'Fixture cleanup failed; reset the disposable local database before further use.',
        error,
      );
      process.exitCode = 1;
    }
  }
}
