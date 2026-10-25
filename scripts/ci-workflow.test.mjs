import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { CONDITIONAL_JOBS, REQUIRED_JOB_IDS } from './ci-impact-registry.mjs';

const workflow = readFileSync(
  new URL('../.github/workflows/ci.yml', import.meta.url),
  'utf8',
);
const baseline = JSON.parse(
  readFileSync(new URL('./ci-workflow-baseline.json', import.meta.url), 'utf8'),
);

// This is an intentionally narrow contract reader for this checked-in workflow,
// not a general YAML parser. Unexpected job layout causes a failing assertion.
function jobBodies(source) {
  const body = source.split('\njobs:\n')[1];
  assert.ok(body, 'Expected one top-level jobs mapping.');
  const headers = [...body.matchAll(/^  ([a-z][a-z0-9-]*):\n/gm)];
  const jobs = Object.fromEntries(
    headers.map((match, index) => [
      match[1],
      body
        .slice(match.index + match[0].length, headers[index + 1]?.index)
        .replace(/^  #.*\n/gm, '')
        .trimEnd() + '\n',
    ]),
  );
  assert.equal(Object.keys(jobs).length, headers.length, 'Duplicate job ID.');
  return jobs;
}

const jobs = jobBodies(workflow);

describe('CI workflow safety and unchanged regression coverage', () => {
  it('registers every workflow job in the stable aggregate and registry', () => {
    assert.deepEqual(
      Object.keys(jobs).sort(),
      [...REQUIRED_JOB_IDS, 'ci-required'].sort(),
    );
    const needs = jobs['ci-required']
      .split('    needs:\n')[1]
      ?.split('    runs-on:')[0];
    assert.ok(needs);
    assert.deepEqual(
      [...needs.matchAll(/^      - ([a-z-]+)$/gm)]
        .map((match) => match[1])
        .sort(),
      [...REQUIRED_JOB_IDS].sort(),
    );
    assert.match(jobs['ci-required'], /^    if: \$\{\{ always\(\) \}\}$/m);
    assert.match(
      jobs['ci-required'],
      /CI_IMPACT_PLAN: \$\{\{ needs\.impact\.outputs\.plan \}\}/,
    );
    assert.match(jobs['ci-required'], /CI_NEEDS: \$\{\{ toJSON\(needs\) \}\}/);
    assert.match(jobs['ci-required'], /run: node scripts\/ci-required\.mjs/);
  });

  it('guards every expensive job with its own explicit plan decision', () => {
    for (const name of CONDITIONAL_JOBS) {
      assert.match(jobs[name], /^    needs: impact$/m);
      assert.ok(
        jobs[name].includes(
          `if: \${{ needs.impact.result == 'success' && fromJSON(needs.impact.outputs.plan).jobs['${name}'] }}`,
        ),
      );
    }
    assert.doesNotMatch(jobs.quality, /^    (?:if|needs):/m);
    assert.doesNotMatch(jobs.impact, /^    (?:if|needs):/m);
    assert.doesNotMatch(workflow, /continue-on-error:/);
  });

  it('runs all dependency-free CI tests before computing any skip decision', () => {
    const tests = jobs.impact.indexOf('run: node --test scripts/ci-*.test.mjs');
    const selector = jobs.impact.indexOf('run: node scripts/ci-impact.mjs');
    assert.ok(tests >= 0 && selector > tests);
    assert.match(jobs.impact, /fetch-depth: 0/);
    assert.match(jobs.impact, /persist-credentials: false/);
    assert.match(jobs.impact, /plan: \$\{\{ steps\.select\.outputs\.plan \}\}/);
  });

  it('keeps fork-safe read-only PR execution with no workflow-level path filtering', () => {
    const trigger = workflow.split('\njobs:\n')[0];
    assert.match(trigger, /^  pull_request:$/m);
    assert.doesNotMatch(
      workflow,
      /pull_request_target|secrets\.|(?:^|\n) *paths(?:-ignore)?:/,
    );
    assert.match(trigger, /permissions:\n  contents: read\n/);
    assert.doesNotMatch(
      trigger,
      /(?:pull-requests|checks|actions|id-token): write/,
    );
  });

  it('covers full main/release/manual/merge-queue runs without develop push duplication', () => {
    const trigger = workflow.split('\njobs:\n')[0];
    assert.match(
      trigger,
      /pull_request:\n    branches: \[develop, main, 'release\/\*\*', 'releases\/\*\*'\]/,
    );
    assert.match(
      trigger,
      /push:\n    branches: \[main, 'release\/\*\*', 'releases\/\*\*'\]/,
    );
    assert.match(trigger, /^  workflow_dispatch:$/m);
    assert.match(trigger, /^  merge_group:$/m);
  });

  it('preserves every step of all 21 existing jobs byte-for-byte', () => {
    assert.equal(baseline.commit, '4b4a9f55de1fb5c61302dcf0fc28d42eae570f65');
    // This historical snapshot is fixed at 21 jobs. A future additional suite
    // belongs in the registry/aggregate, not falsely in this old commit's data.
    assert.equal(Object.keys(baseline.stepHashes).length, 21);
    assert.ok(Object.keys(baseline.stepHashes).every((name) => name in jobs));
    for (const [name, expected] of Object.entries(baseline.stepHashes)) {
      const steps = jobs[name].split('    steps:\n')[1];
      assert.ok(steps, `${name}: missing legacy steps`);
      assert.equal(
        createHash('sha256').update(steps).digest('hex'),
        expected,
        `${name}: original setup/test/cleanup/artifact steps changed`,
      );
    }
  });

  it('retains both pgTAP passes, all concurrency suites, and populated upgrades', () => {
    const database = jobs.database;
    assert.equal(
      (database.match(/run: npm run test:integration\n/g) || []).length,
      2,
    );
    assert.equal(
      (
        database.match(
          /run: (?:npm run test:db:[^\n]*concurrency|node scripts\/test-[^\n]*concurrency\.mjs)\n/g,
        ) || []
      ).length,
      28,
    );
    assert.equal(
      (database.match(/run: node scripts\/test-[^\n]*upgrade\.mjs\n/g) || [])
        .length,
      4,
    );
    assert.match(database, /git diff --exit-code -- src\/types\/database\.ts/);
    assert.match(database, /npm run db:lint/);
    assert.match(database, /npm run typecheck/);
    assert.match(database, /timeout-minutes: 30/);
  });
});
