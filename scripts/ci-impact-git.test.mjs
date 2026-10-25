import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
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

const SCHEDULE = 'src/components/schedules/SchedulesScreen.tsx';
const SETTINGS = 'src/components/admin-settings/AdminSettingsScreen.tsx';
const SHARED = 'src/server/db/client.ts';

function repository(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'trot-ci-impact-'));
  const cwd = join(root, 'source');
  mkdirSync(cwd);
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

function full(plan, reason) {
  assert.equal(plan.mode, 'full');
  if (reason) assert.equal(plan.reason, reason);
  assert.ok(CONDITIONAL_JOBS.every((job) => plan.jobs[job] === true));
  validatePlan(plan);
}

test('whole multi-commit PR is selected from merge base, not its final commit', (t) => {
  const repo = repository(t);
  repo.write(SCHEDULE, 'schedule first commit\n');
  repo.commit('Schedule change');
  repo.write(SETTINGS, 'settings second commit\n');
  repo.commit('Settings change');
  const event = repo.merge();
  const plan = validatePlan(planForEvent(event, repo.cwd));
  assert.equal(plan.mode, 'selective');
  assert.deepEqual(plan.paths, [SETTINGS, SCHEDULE]);
  assert.equal(plan.provenance.mergeBase, repo.initial);
  assert.equal(plan.provenance.testSha, event.sha);
  assert.equal(plan.jobs.database, true);
  assert.equal(plan.jobs['schedules-browser'], true);
  assert.equal(plan.jobs['schedule-notices-browser'], true);
  assert.equal(plan.jobs['admin-settings-browser'], true);
  assert.equal(plan.jobs['enrollment-browser'], false);
});

test('advanced base is distinguished from PR changes in a divergent fork-like history', (t) => {
  const repo = repository(t);
  repo.write(SCHEDULE, 'fork contribution\n');
  const head = repo.commit('Fork feature commit');
  repo.git('checkout', '--quiet', 'develop');
  repo.write('docs/base-only.md', 'Already on the base branch.\n');
  const base = repo.commit('Independent base commit');
  repo.git('checkout', '--quiet', 'feature');
  const event = repo.merge();
  event.event.pull_request.head.repo = { full_name: 'contributor/fork' };
  event.event.pull_request.base.repo = { full_name: 'owner/repository' };
  const plan = validatePlan(planForEvent(event, repo.cwd));
  assert.equal(plan.mode, 'selective');
  assert.deepEqual(plan.paths, [SCHEDULE]);
  assert.equal(plan.provenance.base, base);
  assert.equal(plan.provenance.head, head);
  assert.equal(plan.provenance.mergeBase, repo.initial);
  assert.notEqual(plan.provenance.mergeBase, base);
});

test('rename across feature families includes both previous and current owners', (t) => {
  const repo = repository(t, { [SCHEDULE]: 'identical rename content\n' });
  mkdirSync(dirname(join(repo.cwd, SETTINGS)), { recursive: true });
  renameSync(join(repo.cwd, SCHEDULE), join(repo.cwd, SETTINGS));
  repo.commit('Rename across features');
  const plan = validatePlan(planForEvent(repo.merge(), repo.cwd));
  assert.equal(plan.mode, 'selective');
  assert.deepEqual(plan.paths, [SETTINGS, SCHEDULE]);
  assert.equal(plan.jobs['schedules-browser'], true);
  assert.equal(plan.jobs['admin-settings-browser'], true);
});

test('deleting a feature file retains its old dependency mapping', (t) => {
  const repo = repository(t, {
    [SCHEDULE]: 'remove this schedule component\n',
  });
  rmSync(join(repo.cwd, SCHEDULE));
  repo.commit('Delete schedule component');
  const plan = validatePlan(planForEvent(repo.merge(), repo.cwd));
  assert.equal(plan.mode, 'selective');
  assert.deepEqual(plan.paths, [SCHEDULE]);
  assert.equal(plan.jobs['schedules-browser'], true);
  assert.equal(plan.jobs.database, true);
});

test('deleting a shared file forces full instead of ignoring its absent path', (t) => {
  const repo = repository(t, { [SHARED]: 'shared client\n' });
  rmSync(join(repo.cwd, SHARED));
  repo.commit('Delete shared client');
  const plan = planForEvent(repo.merge(), repo.cwd);
  full(plan, 'full-impact-path');
  assert.deepEqual(plan.paths, [SHARED]);
});

test('renaming a shared file into docs does not disguise shared impact', (t) => {
  const repo = repository(t, { [SHARED]: 'same content across rename\n' });
  const target = 'docs/renamed-client.md';
  mkdirSync(dirname(join(repo.cwd, target)), { recursive: true });
  renameSync(join(repo.cwd, SHARED), join(repo.cwd, target));
  repo.commit('Rename shared client into documentation');
  const plan = planForEvent(repo.merge(), repo.cwd);
  full(plan, 'full-impact-path');
  assert.deepEqual(plan.paths, [target, SHARED]);
});

test('NUL Git diff preserves spaces, newline, Unicode and shell-looking names as data', (t) => {
  const repo = repository(t);
  const unusual =
    'src/components/schedules/한글 [a] $HOME;\n`touch injected`.tsx';
  repo.write(unusual, 'No shell interpretation.\n');
  repo.commit('Unusual path fixture');
  const plan = validatePlan(planForEvent(repo.merge(), repo.cwd));
  assert.equal(plan.mode, 'selective');
  assert.deepEqual(plan.paths, [unusual]);
  assert.equal(plan.jobs['schedules-browser'], true);
  assert.deepEqual(repo.git('status', '--porcelain'), '');
});

test('large PR diff is not limited to a first page of changed filenames', (t) => {
  const repo = repository(t);
  const paths = Array.from(
    { length: 350 },
    (_, index) => `docs/${String(index).padStart(3, '0')}.md`,
  );
  for (const path of paths) repo.write(path, `${path}\n`);
  repo.write(SHARED, 'late shared change must not be missed\n');
  repo.commit('Large PR fixture');
  const plan = planForEvent(repo.merge(), repo.cwd);
  full(plan, 'full-impact-path');
  assert.equal(plan.pathCount, 351);
  assert.deepEqual(plan.paths, [...paths, SHARED]);
});

test('a docs-only PR has an explicit verified skip plan', (t) => {
  const repo = repository(t);
  repo.write('docs/ci-notes.md', 'Documentation only.\n');
  repo.commit('Documentation fixture');
  const plan = validatePlan(planForEvent(repo.merge(), repo.cwd));
  assert.equal(plan.mode, 'docs-only');
  assert.ok(CONDITIONAL_JOBS.every((job) => plan.jobs[job] === false));
  assert.equal(plan.pathCount, 1);
});

test('file type changes force full even under a normally selective feature path', (t) => {
  const repo = repository(t, { [SCHEDULE]: 'ordinary source file\n' });
  rmSync(join(repo.cwd, SCHEDULE));
  symlinkSync('Other.tsx', join(repo.cwd, SCHEDULE));
  repo.commit('File type fixture');
  full(planForEvent(repo.merge(), repo.cwd), 'file-type-change');
});

test('shallow checkout with missing parent objects falls back to full', (t) => {
  const repo = repository(t);
  repo.write(SCHEDULE, 'schedule\n');
  repo.commit('Feature fixture');
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
  full(planForEvent(event, shallow), 'diff-unavailable');
});

test('unavailable event commit object cannot become an empty green selection', (t) => {
  const repo = repository(t);
  repo.write(SCHEDULE, 'schedule\n');
  repo.commit('Feature fixture');
  const event = repo.merge();
  event.event.pull_request.head.sha = 'f'.repeat(40);
  full(planForEvent(event, repo.cwd), 'diff-unavailable');
});

test('event head checkout instead of the tested merge commit forces full', (t) => {
  const repo = repository(t);
  repo.write(SCHEDULE, 'schedule\n');
  const head = repo.commit('Feature fixture');
  const event = repo.merge();
  repo.git('checkout', '--quiet', '--detach', head);
  event.sha = head;
  full(planForEvent(event, repo.cwd), 'merge-parent-mismatch');
});

test('a stale event base cannot selectively describe a different merge commit', (t) => {
  const repo = repository(t);
  repo.write(SCHEDULE, 'schedule\n');
  repo.commit('Feature fixture');
  repo.git('checkout', '--quiet', 'develop');
  repo.write('docs/new-base.md', 'base advance\n');
  repo.commit('Advanced base');
  repo.git('checkout', '--quiet', 'feature');
  const event = repo.merge();
  event.event.pull_request.base.sha = repo.initial;
  full(planForEvent(event, repo.cwd), 'merge-parent-mismatch');
});

test('checkout identity mismatch fails rather than trusting the requested SHA', (t) => {
  const repo = repository(t);
  repo.write(SCHEDULE, 'schedule\n');
  repo.commit('Feature fixture');
  const event = repo.merge();
  event.sha = repo.initial;
  assert.throws(() => planForEvent(event, repo.cwd), /Checkout does not match/);
  event.sha = 'refs/heads/develop; echo unsafe';
  assert.throws(() => planForEvent(event, repo.cwd), /invalid workflow SHA/);
});

for (const baseRef of [
  'main',
  'release/2026-10',
  'releases/2026-10',
  'unknown',
  undefined,
]) {
  test(`PR base ${String(baseRef)} always runs full`, (t) => {
    const repo = repository(t);
    repo.write(SCHEDULE, 'schedule\n');
    repo.commit('Feature fixture');
    const event = repo.merge();
    event.event.pull_request.base.ref = baseRef;
    full(planForEvent(event, repo.cwd), 'protected-or-unknown-base');
  });
}

for (const eventName of [
  'workflow_dispatch',
  'push',
  'merge_group',
  'release',
  'unrecognized',
]) {
  test(`${eventName} cannot request a selective run`, (t) => {
    const repo = repository(t);
    const sha = repo.git('rev-parse', 'HEAD');
    full(planForEvent({ eventName, event: {}, sha }, repo.cwd), 'full-event');
  });
}

test('missing or malformed PR commit metadata broadens the run', (t) => {
  const repo = repository(t);
  const sha = repo.git('rev-parse', 'HEAD');
  for (const head of [undefined, {}, { sha: 'not-a-commit' }]) {
    full(
      planForEvent(
        {
          eventName: 'pull_request',
          event: { pull_request: { base: { ref: 'develop', sha }, head } },
          sha,
        },
        repo.cwd,
      ),
      'missing-pr-commits',
    );
  }
});

test('an empty tree diff is a full run, not a documentation-only skip', (t) => {
  const repo = repository(t);
  repo.git('commit', '--quiet', '--allow-empty', '-m', 'Empty feature commit');
  const plan = planForEvent(repo.merge(), repo.cwd);
  full(plan, 'empty-diff');
  assert.deepEqual(plan.paths, []);
});

test('criss-cross history with two merge bases broadens rather than picking one', (t) => {
  const repo = repository(t);
  const tree = repo.git('rev-parse', 'HEAD^{tree}');
  const first = repo.git(
    'commit-tree',
    tree,
    '-p',
    repo.initial,
    '-m',
    'First branch',
  );
  const second = repo.git(
    'commit-tree',
    tree,
    '-p',
    repo.initial,
    '-m',
    'Second branch',
  );
  const base = repo.git(
    'commit-tree',
    tree,
    '-p',
    first,
    '-p',
    second,
    '-m',
    'First merge',
  );
  const head = repo.git(
    'commit-tree',
    tree,
    '-p',
    second,
    '-p',
    first,
    '-m',
    'Second merge',
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
  full(
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
    ),
    'ambiguous-merge-base',
  );
});

test('unrelated commit histories cannot produce an empty selective plan', (t) => {
  const repo = repository(t);
  const tree = repo.git('rev-parse', 'HEAD^{tree}');
  const base = repo.initial;
  const head = repo.git('commit-tree', tree, '-m', 'Unrelated feature root');
  const sha = repo.git(
    'commit-tree',
    tree,
    '-p',
    base,
    '-p',
    head,
    '-m',
    'Unrelated PR merge',
  );
  repo.git('checkout', '--quiet', '--detach', sha);
  full(
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
    ),
    'diff-unavailable',
  );
});

test('selector CLI emits a single-line verified docs-only plan and run summary', (t) => {
  const repo = repository(t);
  repo.write('docs/cli-smoke.md', 'Documentation-only CLI fixture.\n');
  repo.commit('CLI documentation fixture');
  const event = repo.merge();
  const eventPath = join(repo.root, 'event.json');
  const outputPath = join(repo.root, 'output.txt');
  const summaryPath = join(repo.root, 'summary.md');
  writeFileSync(eventPath, JSON.stringify(event.event));
  const stdout = execFileSync(
    process.execPath,
    [fileURLToPath(new URL('./ci-impact.mjs', import.meta.url))],
    {
      cwd: repo.cwd,
      env: {
        ...repo.env,
        GITHUB_EVENT_NAME: event.eventName,
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_SHA: event.sha,
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: summaryPath,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const output = readFileSync(outputPath, 'utf8');
  assert.match(output, /^plan=[^\n]+\n$/);
  const plan = validatePlan(JSON.parse(output.slice('plan='.length).trim()));
  assert.equal(plan.mode, 'docs-only');
  assert.equal(plan.provenance.testSha, event.sha);
  assert.deepEqual(plan.paths, ['docs/cli-smoke.md']);
  assert.ok(CONDITIONAL_JOBS.every((job) => plan.jobs[job] === false));
  assert.equal(JSON.parse(stdout).mode, 'docs-only');
  const summary = readFileSync(summaryPath, 'utf8');
  assert.match(summary, /CI impact plan/);
  assert.match(summary, /documentation-only skip/);
  assert.match(summary, /docs\/cli-smoke\.md/);
  assert.equal(repo.git('status', '--porcelain'), '');
  assert.equal(repo.git('rev-parse', 'HEAD'), event.sha);
});
