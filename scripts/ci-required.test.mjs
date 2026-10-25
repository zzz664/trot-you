import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { selectImpact } from './ci-impact.mjs';
import { validateResults } from './ci-required.mjs';
import { CONDITIONAL_JOBS, REQUIRED_JOB_IDS } from './ci-impact-registry.mjs';

const SHA = '1'.repeat(40);
const provenance = {
  event: 'pull_request',
  testSha: SHA,
  baseRef: 'develop',
  base: '2'.repeat(40),
  head: '3'.repeat(40),
  mergeBase: '2'.repeat(40),
};
const selectivePlan = () =>
  selectImpact(['src/components/schedules/SchedulesScreen.tsx'], {
    provenance: { ...provenance },
  });
const docsPlan = () =>
  selectImpact(['docs/ci.md'], { provenance: { ...provenance } });
const fullPlan = () =>
  selectImpact(['supabase/migrations/change.sql'], {
    provenance: { ...provenance },
  });

function results(plan) {
  return Object.fromEntries(
    REQUIRED_JOB_IDS.map((job) => [
      job,
      {
        result:
          !CONDITIONAL_JOBS.includes(job) || plan.jobs[job]
            ? 'success'
            : 'skipped',
      },
    ]),
  );
}

for (const [name, factory] of [
  ['full', fullPlan],
  ['selective', selectivePlan],
  ['docs-only', docsPlan],
]) {
  test(`${name} accepts only successful required jobs and explicit planned skips`, () => {
    const plan = factory();
    assert.match(
      validateResults(plan, results(plan), SHA),
      /Every required job succeeded/,
    );
  });
}

for (const result of [
  'failure',
  'cancelled',
  'skipped',
  'neutral',
  'timed_out',
  undefined,
  '',
]) {
  test(`selected browser result ${String(result)} fails the aggregate`, () => {
    const plan = selectivePlan();
    const needs = results(plan);
    needs['schedules-browser'].result = result;
    assert.throws(
      () => validateResults(plan, needs, SHA),
      /schedules-browser: expected success/,
    );
  });
}

for (const job of ['impact', 'quality', 'database']) {
  for (const result of ['failure', 'cancelled', 'skipped']) {
    test(`${job} ${result} cannot be hidden by downstream skips`, () => {
      const plan = selectivePlan();
      const needs = results(plan);
      needs[job].result = result;
      assert.throws(() => validateResults(plan, needs, SHA));
    });
  }
}

for (const result of [
  'failure',
  'cancelled',
  'success',
  'neutral',
  undefined,
]) {
  test(`unselected browser result ${String(result)} is not an intentional skip`, () => {
    const plan = selectivePlan();
    const needs = results(plan);
    needs['enrollment-browser'].result = result;
    assert.throws(
      () => validateResults(plan, needs, SHA),
      /enrollment-browser: expected skipped/,
    );
  });
}

test('docs-only may skip DB, but never quality or selector validation', () => {
  const plan = docsPlan();
  const needs = results(plan);
  assert.equal(needs.database.result, 'skipped');
  for (const job of ['quality', 'impact']) {
    const changed = structuredClone(needs);
    changed[job].result = 'skipped';
    assert.throws(() => validateResults(plan, changed, SHA));
  }
});

test('new calendar failures and stale inventories cannot pass the aggregate', () => {
  const plan = fullPlan();
  for (const result of ['failure', 'cancelled', 'skipped']) {
    const needs = results(plan);
    needs['content-calendar-browser'].result = result;
    assert.throws(
      () => validateResults(plan, needs, SHA),
      /content-calendar-browser: expected success/,
    );
  }
  const missing = results(plan);
  delete missing['content-calendar-browser'];
  assert.throws(() => validateResults(plan, missing, SHA), /inventory/);
  delete plan.jobs['content-calendar-browser'];
  assert.throws(
    () => validateResults(plan, results(plan), SHA),
    /job inventory/,
  );
});

test('selected DB failure is not accepted when every browser passed', () => {
  const plan = fullPlan();
  const needs = results(plan);
  needs.database.result = 'failure';
  assert.throws(
    () => validateResults(plan, needs, SHA),
    /database: expected success/,
  );
});

test('missing expected job or unknown extra job fails inventory verification', () => {
  const plan = selectivePlan();
  for (const job of REQUIRED_JOB_IDS) {
    const needs = results(plan);
    delete needs[job];
    assert.throws(() => validateResults(plan, needs, SHA), undefined, job);
  }
  const needs = results(plan);
  needs['new-unregistered-browser'] = { result: 'success' };
  assert.throws(() => validateResults(plan, needs, SHA), /inventory/);
});

test('missing needs and failed selector reject before trusting plan outputs', () => {
  for (const needs of [null, undefined, {}, { impact: { result: 'failure' } }])
    assert.throws(
      () => validateResults(null, needs, SHA),
      /Impact selection did not succeed/,
    );
});

test('null, empty, unknown version and unknown mode plans fail closed', () => {
  const valid = selectivePlan();
  const needs = results(valid);
  for (const plan of [
    null,
    undefined,
    {},
    '',
    { ...valid, version: 2 },
    { ...valid, mode: 'skip' },
  ])
    assert.throws(
      () => validateResults(plan, needs, SHA),
      /Invalid impact plan/,
    );
});

test('a plan from another SHA cannot satisfy this workflow', () => {
  const plan = selectivePlan();
  assert.throws(
    () => validateResults(plan, results(plan), '4'.repeat(40)),
    /another workflow commit/,
  );
  assert.throws(
    () => validateResults(plan, results(plan), undefined),
    /another workflow commit/,
  );
});

test('job map cannot turn a selected browser or DB into a justified skip', () => {
  for (const job of ['schedules-browser', 'database']) {
    const plan = selectivePlan();
    plan.jobs[job] = false;
    assert.throws(
      () => validateResults(plan, results(plan), SHA),
      /job inventory/,
    );
  }
});

test('job map must contain every conditional job exactly and use booleans', () => {
  for (const value of ['true', 'false', 1, 0, null, undefined]) {
    const plan = selectivePlan();
    plan.jobs.database = value;
    assert.throws(
      () => validateResults(plan, results(plan), SHA),
      /job inventory/,
    );
  }
  const missing = selectivePlan();
  delete missing.jobs['enrollment-browser'];
  assert.throws(
    () => validateResults(missing, results(missing), SHA),
    /job inventory/,
  );
  const extra = selectivePlan();
  extra.jobs['unknown-browser'] = false;
  assert.throws(
    () => validateResults(extra, results(extra), SHA),
    /job inventory/,
  );
});

test('tampered path evidence, digest, rules and count cannot authorize skipping', () => {
  const changes = [
    (plan) => {
      plan.paths = ['docs/disguised.md'];
    },
    (plan) => {
      plan.pathDigest = '0'.repeat(64);
    },
    (plan) => {
      plan.pathCount = 0;
    },
    (plan) => {
      plan.rules = [];
    },
    (plan) => {
      plan.reason = 'documentation-only';
    },
    (plan) => {
      plan.mode = 'docs-only';
    },
    (plan) => {
      plan.paths = null;
    },
  ];
  for (const change of changes) {
    const plan = selectivePlan();
    change(plan);
    assert.throws(() => validateResults(plan, results(plan), SHA));
  }
});

test('selective plans require pull_request/develop and verified commit evidence', () => {
  const changes = [
    (plan) => {
      plan.provenance.event = 'workflow_dispatch';
    },
    (plan) => {
      plan.provenance.baseRef = 'main';
    },
    (plan) => {
      plan.provenance.base = undefined;
    },
    (plan) => {
      plan.provenance.head = 'branch-name';
    },
    (plan) => {
      plan.provenance.mergeBase = undefined;
    },
    (plan) => {
      plan.provenance.testSha = undefined;
    },
  ];
  for (const change of changes) {
    const plan = selectivePlan();
    change(plan);
    assert.throws(() => validateResults(plan, results(plan), SHA));
  }
});

test('full fallback cannot be narrowed by forged rule IDs', () => {
  const plan = fullPlan();
  plan.jobs['schedules-browser'] = false;
  plan.rules = ['schedules-and-notices'];
  assert.throws(() => validateResults(plan, results(plan), SHA));
});

test('aggregate CLI accepts the planned results and exits nonzero on selected failure', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'trot-ci-required-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const summaryPath = join(cwd, 'summary.md');
  const script = fileURLToPath(new URL('./ci-required.mjs', import.meta.url));
  const plan = selectivePlan();
  const needs = results(plan);
  const env = {
    ...process.env,
    CI_IMPACT_PLAN: JSON.stringify(plan),
    CI_NEEDS: JSON.stringify(needs),
    GITHUB_SHA: SHA,
    GITHUB_STEP_SUMMARY: summaryPath,
  };
  const stdout = execFileSync(process.execPath, [script], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(stdout, /Every required job succeeded/);
  const summary = readFileSync(summaryPath, 'utf8');
  assert.match(summary, /Required CI result/);
  assert.match(summary, /every skip is explicitly justified/);
  needs['schedules-browser'].result = 'failure';
  const failed = spawnSync(process.execPath, [script], {
    cwd,
    env: { ...env, CI_NEEDS: JSON.stringify(needs) },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(failed.error, undefined);
  assert.equal(failed.status, 1);
  assert.match(
    failed.stderr,
    /schedules-browser: expected success, received failure/,
  );
  assert.equal(failed.stdout, '');
  assert.equal(readFileSync(summaryPath, 'utf8'), summary);
});
