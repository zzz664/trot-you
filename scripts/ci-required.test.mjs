import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { selectImpact } from './ci-impact.mjs';
import { validateResults } from './ci-required.mjs';
import {
  BROWSER_JOBS,
  CONDITIONAL_JOBS,
  REQUIRED_JOB_IDS,
} from './ci-impact-registry.mjs';

const SHA = '1'.repeat(40);
const base = '2'.repeat(40);
const provenance = {
  event: 'pull_request',
  testSha: SHA,
  baseRef: 'develop',
  base,
  head: '3'.repeat(40),
  mergeBase: base,
};
const path = 'src/components/analytics-funnel/AnalyticsFunnelScreen.tsx';
const emptySelection = () => ({
  typecheck: false,
  unit: [],
  fixtures: [],
  sql: [],
  races: [],
  upgrades: [],
  browser: {},
});
const scopedPlan = (browser = 'analytics-funnel-browser', database = true) =>
  selectImpact([path], {
    provenance: { ...provenance },
    scopes: [
      {
        version: 1,
        id: 'analytics-funnel',
        base,
        covers: [path],
        reason: 'Only selected analytics boundary checks.',
        selection: {
          ...emptySelection(),
          unit: ['tests/unit/analytics-funnel-ui.test.tsx'],
          sql: database ? ['supabase/tests/analytics_funnel.test.sql'] : [],
          browser: browser
            ? {
                [browser]: [
                  {
                    file: 'tests/e2e/analytics-funnel/analytics-funnel.spec.ts',
                    grep: 'current authority',
                  },
                ],
              }
            : {},
        },
      },
    ],
  });
const docsPlan = () =>
  selectImpact(['docs/ci.md'], { provenance: { ...provenance }, scopes: [] });
const results = (plan) =>
  Object.fromEntries(
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

for (const [name, factory] of [
  ['scoped', scopedPlan],
  ['docs-only', docsPlan],
  ['unit-only', () => scopedPlan(null, false)],
]) {
  test(`${name} requires selected successes and explicitly justified skips`, () => {
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
  test(`selected browser ${String(result)} fails closed`, () => {
    const plan = scopedPlan();
    const needs = results(plan);
    needs['analytics-funnel-browser'].result = result;
    assert.throws(
      () => validateResults(plan, needs, SHA),
      /analytics-funnel-browser: expected success/,
    );
  });
}
for (const job of ['impact', 'quality', 'database'])
  for (const result of ['failure', 'cancelled', 'skipped']) {
    test(`${job} ${result} cannot be hidden by intentional downstream skips`, () => {
      const plan = scopedPlan();
      const needs = results(plan);
      needs[job].result = result;
      assert.throws(() => validateResults(plan, needs, SHA));
    });
  }
for (const result of [
  'success',
  'failure',
  'cancelled',
  'neutral',
  undefined,
]) {
  test(`unselected browser ${String(result)} is not an intentional skip`, () => {
    const plan = scopedPlan();
    const needs = results(plan);
    needs['enrollment-browser'].result = result;
    assert.throws(
      () => validateResults(plan, needs, SHA),
      /enrollment-browser: expected skipped/,
    );
  });
}

test('docs-only skips database and browsers but never quality or impact validation', () => {
  const plan = docsPlan();
  for (const job of ['quality', 'impact']) {
    const needs = results(plan);
    needs[job].result = 'skipped';
    assert.throws(() => validateResults(plan, needs, SHA));
  }
  assert.ok(
    CONDITIONAL_JOBS.every((job) => results(plan)[job].result === 'skipped'),
  );
});

for (const job of BROWSER_JOBS)
  test(`${job} remains in fail-closed aggregate inventory without running its suite`, () => {
    const plan = scopedPlan(job);
    const needs = results(plan);
    needs[job].result = 'failure';
    assert.throws(
      () => validateResults(plan, needs, SHA),
      new RegExp(`${job}: expected success`),
    );
    delete needs[job];
    assert.throws(() => validateResults(plan, needs, SHA), /inventory/);
  });

test('missing and additional jobs fail inventory verification', () => {
  const plan = scopedPlan();
  for (const job of REQUIRED_JOB_IDS) {
    const needs = results(plan);
    delete needs[job];
    assert.throws(() => validateResults(plan, needs, SHA), undefined, job);
  }
  const needs = results(plan);
  needs['unregistered-browser'] = { result: 'success' };
  assert.throws(() => validateResults(plan, needs, SHA), /inventory/);
});

test('failed selector never authorizes outputs or skipped jobs', () => {
  for (const needs of [null, undefined, {}, { impact: { result: 'failure' } }])
    assert.throws(
      () => validateResults(null, needs, SHA),
      /Impact selection did not succeed/,
    );
});

test('null plans, old versions and legacy modes cannot authorize a cumulative run', () => {
  const valid = scopedPlan();
  for (const plan of [
    null,
    undefined,
    {},
    '',
    { ...valid, version: 1 },
    { ...valid, version: 3 },
    { ...valid, mode: 'full' },
    { ...valid, mode: 'selective' },
    { ...valid, mode: 'skip' },
  ])
    assert.throws(() => validateResults(plan, results(valid), SHA));
});

test('another workflow SHA or missing expected SHA is rejected', () => {
  const plan = scopedPlan();
  assert.throws(
    () => validateResults(plan, results(plan), '4'.repeat(40)),
    /another workflow commit/,
  );
  assert.throws(
    () => validateResults(plan, results(plan), undefined),
    /another workflow commit/,
  );
});

test('selected job cannot be rewritten into a justified skip', () => {
  for (const job of ['database', 'analytics-funnel-browser']) {
    const plan = scopedPlan();
    plan.jobs[job] = false;
    assert.throws(() => validateResults(plan, results(plan), SHA));
  }
});

test('conditional job map is complete and strictly boolean', () => {
  for (const value of ['true', 'false', 1, 0, null, undefined]) {
    const plan = scopedPlan();
    plan.jobs.database = value;
    assert.throws(() => validateResults(plan, results(plan), SHA));
  }
  const missing = scopedPlan();
  delete missing.jobs['enrollment-browser'];
  assert.throws(() => validateResults(missing, results(missing), SHA));
  const extra = scopedPlan();
  extra.jobs['unknown-browser'] = false;
  assert.throws(() => validateResults(extra, results(extra), SHA));
});

test('aggregate recomputes changed paths, scopes, selection and evidence before accepting skips', () => {
  const mutations = [
    (p) => {
      p.changedPaths = ['docs/disguised.md'];
    },
    (p) => {
      p.pathDigest = '0'.repeat(64);
    },
    (p) => {
      p.pathCount = 0;
    },
    (p) => {
      p.scopes = [];
    },
    (p) => {
      p.selection.unit = [];
    },
    (p) => {
      p.selection.sql = [];
    },
    (p) => {
      p.selection.browser = {};
    },
    (p) => {
      p.scopes[0].selection.sql = [];
    },
    (p) => {
      p.scopes[0].base = '4'.repeat(40);
    },
    (p) => {
      p.mode = 'docs-only';
    },
  ];
  for (const mutate of mutations) {
    const plan = structuredClone(scopedPlan());
    mutate(plan);
    assert.throws(() => validateResults(plan, results(plan), SHA));
  }
});

test('scoped and docs plans require complete pull_request/develop provenance', () => {
  for (const factory of [scopedPlan, docsPlan])
    for (const mutation of [
      { event: 'push' },
      { baseRef: 'main' },
      { base: undefined },
      { head: 'branch' },
      { mergeBase: undefined },
      { testSha: undefined },
    ]) {
      const plan = factory();
      Object.assign(plan.provenance, mutation);
      assert.throws(() => validateResults(plan, results(plan), SHA));
    }
});

test('aggregate CLI accepts exact scoped results and rejects selected failure without changing summary', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'trot-ci-required-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const summaryPath = join(cwd, 'summary.md');
  const script = fileURLToPath(new URL('./ci-required.mjs', import.meta.url));
  const plan = scopedPlan();
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
  needs['analytics-funnel-browser'].result = 'failure';
  const failed = spawnSync(process.execPath, [script], {
    cwd,
    env: { ...env, CI_NEEDS: JSON.stringify(needs) },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, '');
  assert.match(
    failed.stderr,
    /analytics-funnel-browser: expected success, received failure/,
  );
  assert.equal(readFileSync(summaryPath, 'utf8'), summary);
});
