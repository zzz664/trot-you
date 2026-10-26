import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { planForEvent, validatePlan } from './ci-impact.mjs';
import { CONDITIONAL_JOBS } from './ci-impact-registry.mjs';

const FIRST = 'src/server/services/analytics/capture.ts';
const SECOND = 'src/components/analytics-funnel/AnalyticsFunnelScreen.tsx';
const SHARED = 'src/server/db/client.ts';
const selection = () => ({
  typecheck: false,
  unit: ['tests/unit/analytics-capture.test.ts'],
  fixtures: [],
  sql: [],
  races: [],
  upgrades: [],
  browser: {},
});
const scopes = (base, covers) => [
  {
    version: 1,
    id: 'fixture-scope',
    base,
    covers,
    reason: 'Exact changed paths in disposable history.',
    selection: selection(),
  },
];
function repository(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'trot-ci-impact-'));
  const cwd = join(root, 'source');
  mkdirSync(cwd);
  mkdirSync(join(cwd, 'ci/scopes'), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'CI fixture',
    GIT_AUTHOR_EMAIL: 'ci-fixture@example.invalid',
    GIT_COMMITTER_NAME: 'CI fixture',
    GIT_COMMITTER_EMAIL: 'ci-fixture@example.invalid',
    GIT_TERMINAL_PROMPT: '0',
  };
  const git = (...args) =>
    execFileSync(
      'git',
      ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args],
      { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  const write = (path, content) => {
    const target = join(cwd, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  const commit = (message) => {
    git('add', '--all');
    git('commit', '--quiet', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '--quiet', '--initial-branch=develop');
  write('fixture.txt', 'Disposable Git history only.\n');
  for (const [path, content] of Object.entries(files)) write(path, content);
  const initial = commit('Initial fixture');
  git('checkout', '--quiet', '-b', 'feature');
  const merge = () => {
    const head = git('rev-parse', 'HEAD');
    git('checkout', '--quiet', 'develop');
    const base = git('rev-parse', 'HEAD');
    git('merge', '--quiet', '--no-ff', 'feature', '-m', 'Synthetic PR merge');
    const sha = git('rev-parse', 'HEAD');
    return {
      eventName: 'pull_request',
      event: {
        pull_request: {
          base: { ref: 'develop', sha: base },
          head: { ref: 'feature', sha: head },
        },
      },
      sha,
    };
  };
  return { root, cwd, env, git, write, commit, initial, merge };
}

const planned = (repo, event, covers, base = repo.initial) =>
  validatePlan(planForEvent(event, repo.cwd, scopes(base, covers)));

test('complete multi-commit PR scope is computed from merge base, not final commit', (t) => {
  const repo = repository(t);
  repo.write(FIRST, 'first source change\n');
  repo.commit('First change');
  repo.write(SECOND, 'second source change\n');
  repo.commit('Second change');
  const event = repo.merge();
  const plan = planned(repo, event, [FIRST, SECOND]);
  assert.equal(plan.mode, 'scoped');
  assert.deepEqual(plan.changedPaths, [FIRST, SECOND].sort());
  assert.equal(plan.provenance.mergeBase, repo.initial);
  assert.equal(plan.provenance.testSha, event.sha);
  assert.deepEqual(plan.selection.unit, selection().unit);
  assert.ok(CONDITIONAL_JOBS.every((job) => !plan.jobs[job]));
  assert.throws(() => planned(repo, event, [SECOND]));
});

test('advanced base stays distinct from fork-like PR merge-base changes', (t) => {
  const repo = repository(t);
  repo.write(FIRST, 'fork contribution\n');
  const head = repo.commit('Fork source');
  repo.git('checkout', '--quiet', 'develop');
  repo.write('docs/base-only.md', 'Already merged on base.\n');
  const base = repo.commit('Base advance');
  repo.git('checkout', '--quiet', 'feature');
  const event = repo.merge();
  event.event.pull_request.head.repo = { full_name: 'contributor/fork' };
  const plan = planned(repo, event, [FIRST]);
  assert.deepEqual(plan.changedPaths, [FIRST]);
  assert.equal(plan.provenance.base, base);
  assert.equal(plan.provenance.head, head);
  assert.equal(plan.provenance.mergeBase, repo.initial);
  assert.throws(() => planned(repo, event, [FIRST], base));
});

test('rename requires coverage of both old and new exact paths', (t) => {
  const repo = repository(t, { [FIRST]: 'unchanged rename content\n' });
  mkdirSync(dirname(join(repo.cwd, SECOND)), { recursive: true });
  renameSync(join(repo.cwd, FIRST), join(repo.cwd, SECOND));
  repo.commit('Rename source');
  const event = repo.merge();
  assert.deepEqual(
    planned(repo, event, [FIRST, SECOND]).changedPaths,
    [FIRST, SECOND].sort(),
  );
  assert.throws(() => planned(repo, event, [SECOND]));
});

test('deletion requires scope for removed source and never ignores its absence', (t) => {
  const repo = repository(t, { [SHARED]: 'removed shared source\n' });
  rmSync(join(repo.cwd, SHARED));
  repo.commit('Delete shared source');
  const event = repo.merge();
  assert.throws(() => planForEvent(event, repo.cwd, []));
  const plan = planned(repo, event, [SHARED]);
  assert.deepEqual(plan.changedPaths, [SHARED]);
  assert.equal(plan.mode, 'scoped');
  assert.equal(plan.jobs.database, false);
});

test('moving executable source into docs cannot disguise its removed path', (t) => {
  const repo = repository(t, { [SHARED]: 'same content\n' });
  const destination = 'docs/renamed-client.md';
  mkdirSync(dirname(join(repo.cwd, destination)), { recursive: true });
  renameSync(join(repo.cwd, SHARED), join(repo.cwd, destination));
  repo.commit('Move source into docs');
  const event = repo.merge();
  assert.throws(() => planForEvent(event, repo.cwd, []));
  assert.deepEqual(
    planned(repo, event, [SHARED]).changedPaths,
    [destination, SHARED].sort(),
  );
});

test('type changes require an explicit exact-path scope without cumulative fallback', (t) => {
  const repo = repository(t, { [FIRST]: 'regular file\n' });
  rmSync(join(repo.cwd, FIRST));
  symlinkSync('Other.ts', join(repo.cwd, FIRST));
  repo.commit('Change source type');
  const event = repo.merge();
  assert.throws(() => planForEvent(event, repo.cwd, []));
  assert.equal(planned(repo, event, [FIRST]).mode, 'scoped');
});

test('untrusted filename remains data and missing scope fails without executing shell', (t) => {
  const repo = repository(t);
  const unusual = 'src/한글 [a] $HOME;\n`touch injected`.tsx';
  repo.write(unusual, 'Only filename bytes.\n');
  repo.commit('Untrusted filename');
  assert.throws(() => planForEvent(repo.merge(), repo.cwd, []));
  assert.equal(existsSync(join(repo.cwd, 'injected')), false);
  assert.equal(repo.git('status', '--porcelain'), '');
});

test('large complete PR diff preserves late shared change rather than truncating evidence', (t) => {
  const repo = repository(t);
  const docs = Array.from(
    { length: 350 },
    (_, i) => `docs/${String(i).padStart(3, '0')}.md`,
  );
  for (const path of docs) repo.write(path, `${path}\n`);
  repo.write(SHARED, 'late shared path\n');
  repo.commit('Large diff');
  const event = repo.merge();
  assert.throws(() => planForEvent(event, repo.cwd, []));
  const plan = planned(repo, event, [SHARED]);
  assert.equal(plan.pathCount, 351);
  assert.deepEqual(plan.changedPaths, [...docs, SHARED].sort());
});

test('docs and instruction-only PR uses verified empty selection', (t) => {
  const repo = repository(t);
  repo.write('docs/notes.md', 'Docs only.\n');
  repo.write('AGENTS.md', 'Instructions only.\n');
  repo.commit('Documentation');
  const plan = validatePlan(planForEvent(repo.merge(), repo.cwd, []));
  assert.equal(plan.mode, 'docs-only');
  assert.deepEqual(plan.selection.unit, []);
  assert.equal(plan.selection.typecheck, false);
  assert.ok(CONDITIONAL_JOBS.every((job) => !plan.jobs[job]));
});

test('shallow checkout missing history throws rather than scheduling all tests', (t) => {
  const repo = repository(t);
  repo.write(FIRST, 'change\n');
  repo.commit('Change');
  const event = repo.merge();
  const shallow = join(repo.root, 'shallow');
  repo.git(
    'clone',
    '--quiet',
    '--depth=1',
    '--no-local',
    pathToFileURL(repo.cwd).href,
    shallow,
  );
  assert.throws(() =>
    planForEvent(event, shallow, scopes(repo.initial, [FIRST])),
  );
});

test('missing commit and wrong merge parents fail closed', (t) => {
  const repo = repository(t);
  repo.write(FIRST, 'change\n');
  const head = repo.commit('Change');
  const event = repo.merge();
  const missing = structuredClone(event);
  missing.event.pull_request.head.sha = 'f'.repeat(40);
  assert.throws(() => planned(repo, missing, [FIRST]));
  repo.git('checkout', '--quiet', '--detach', head);
  assert.throws(() => planned(repo, { ...event, sha: head }, [FIRST]));
});

test('stale event base cannot describe the tested merge', (t) => {
  const repo = repository(t);
  repo.write(FIRST, 'change\n');
  repo.commit('Change');
  repo.git('checkout', '--quiet', 'develop');
  repo.write('docs/base.md', 'advance\n');
  repo.commit('Advance');
  repo.git('checkout', '--quiet', 'feature');
  const event = repo.merge();
  event.event.pull_request.base.sha = repo.initial;
  assert.throws(() => planned(repo, event, [FIRST]));
});

test('checkout mismatch and unsafe SHA never become a runnable plan', (t) => {
  const repo = repository(t);
  repo.write(FIRST, 'change\n');
  repo.commit('Change');
  const event = repo.merge();
  assert.throws(() => planned(repo, { ...event, sha: repo.initial }, [FIRST]));
  assert.throws(() =>
    planned(repo, { ...event, sha: 'refs/heads/develop; echo unsafe' }, [
      FIRST,
    ]),
  );
});

for (const baseRef of ['main', 'release/2026-10', 'unknown', undefined])
  test(`base ${String(baseRef)} is not an authorized scoped development PR`, (t) => {
    const repo = repository(t);
    repo.write(FIRST, 'change\n');
    repo.commit('Change');
    const event = repo.merge();
    event.event.pull_request.base.ref = baseRef;
    assert.throws(() => planned(repo, event, [FIRST]));
  });
for (const eventName of [
  'workflow_dispatch',
  'push',
  'merge_group',
  'release',
  'unrecognized',
])
  test(`${eventName} fails instead of selecting a cumulative run`, (t) => {
    const repo = repository(t);
    const sha = repo.git('rev-parse', 'HEAD');
    assert.throws(() =>
      planForEvent({ eventName, event: {}, sha }, repo.cwd, []),
    );
  });

test('malformed metadata and empty diff fail closed', (t) => {
  const repo = repository(t);
  const sha = repo.git('rev-parse', 'HEAD');
  for (const head of [undefined, {}, { sha: 'not-a-commit' }])
    assert.throws(() =>
      planForEvent(
        {
          eventName: 'pull_request',
          event: { pull_request: { base: { ref: 'develop', sha }, head } },
          sha,
        },
        repo.cwd,
        [],
      ),
    );
  repo.git('commit', '--quiet', '--allow-empty', '-m', 'Empty change');
  assert.throws(() => planForEvent(repo.merge(), repo.cwd, []));
  assert.throws(() =>
    planForEvent(
      { eventName: 'pull_request', event: {}, sha },
      join(repo.root, 'not-a-repository'),
      [],
    ),
  );
});

test('criss-cross merge-base ambiguity is rejected without choosing a narrower history', (t) => {
  const repo = repository(t);
  const tree = repo.git('rev-parse', 'HEAD^{tree}');
  const first = repo.git(
    'commit-tree',
    tree,
    '-p',
    repo.initial,
    '-m',
    'First',
  );
  const second = repo.git(
    'commit-tree',
    tree,
    '-p',
    repo.initial,
    '-m',
    'Second',
  );
  const base = repo.git(
    'commit-tree',
    tree,
    '-p',
    first,
    '-p',
    second,
    '-m',
    'Merge A',
  );
  const head = repo.git(
    'commit-tree',
    tree,
    '-p',
    second,
    '-p',
    first,
    '-m',
    'Merge B',
  );
  const sha = repo.git(
    'commit-tree',
    tree,
    '-p',
    base,
    '-p',
    head,
    '-m',
    'PR merge',
  );
  repo.git('checkout', '--quiet', '--detach', sha);
  assert.equal(
    repo.git('merge-base', '--all', base, head).split('\n').length,
    2,
  );
  assert.throws(() =>
    planForEvent(
      {
        eventName: 'pull_request',
        event: {
          pull_request: {
            base: { ref: 'develop', sha: base },
            head: { sha: head },
          },
        },
        sha,
      },
      repo.cwd,
      [],
    ),
  );
});

test('unrelated histories cannot produce a runnable empty scope', (t) => {
  const repo = repository(t);
  const tree = repo.git('rev-parse', 'HEAD^{tree}');
  const base = repo.initial;
  const head = repo.git('commit-tree', tree, '-m', 'Unrelated');
  const sha = repo.git(
    'commit-tree',
    tree,
    '-p',
    base,
    '-p',
    head,
    '-m',
    'Merge',
  );
  repo.git('checkout', '--quiet', '--detach', sha);
  assert.throws(() =>
    planForEvent(
      {
        eventName: 'pull_request',
        event: {
          pull_request: {
            base: { ref: 'develop', sha: base },
            head: { sha: head },
          },
        },
        sha,
      },
      repo.cwd,
      [],
    ),
  );
});

test('selector CLI emits one verified docs plan and refuses non-PR execution without outputs', (t) => {
  const repo = repository(t);
  repo.write('docs/cli.md', 'Only docs.\n');
  repo.commit('Docs');
  const event = repo.merge();
  const eventPath = join(repo.root, 'event.json');
  const output = join(repo.root, 'output.txt');
  const summary = join(repo.root, 'summary.md');
  writeFileSync(eventPath, JSON.stringify(event.event));
  const script = fileURLToPath(new URL('./ci-impact.mjs', import.meta.url));
  const env = {
    ...repo.env,
    GITHUB_EVENT_NAME: event.eventName,
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_SHA: event.sha,
    GITHUB_OUTPUT: output,
    GITHUB_STEP_SUMMARY: summary,
  };
  execFileSync(process.execPath, [script], {
    cwd: repo.cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const text = readFileSync(output, 'utf8');
  assert.match(text, /^plan=[^\n]+\n$/);
  const plan = validatePlan(JSON.parse(text.slice('plan='.length).trim()));
  assert.equal(plan.mode, 'docs-only');
  assert.deepEqual(plan.changedPaths, ['docs/cli.md']);
  assert.match(readFileSync(summary, 'utf8'), /CI plan/);
  const failedOutput = join(repo.root, 'failed-output.txt');
  const failed = spawnSync(process.execPath, [script], {
    cwd: repo.cwd,
    env: { ...env, GITHUB_EVENT_NAME: 'push', GITHUB_OUTPUT: failedOutput },
    encoding: 'utf8',
  });
  assert.equal(failed.status, 1);
  assert.equal(existsSync(failedOutput), false);
  assert.equal(repo.git('status', '--porcelain'), '');
});
