import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  BROWSER_JOBS,
  CONDITIONAL_JOBS,
  REQUIRED_JOB_IDS,
} from './ci-impact-registry.mjs';

const workflow = readFileSync(
  new URL('../.github/workflows/ci.yml', import.meta.url),
  'utf8',
);
const baseline = JSON.parse(
  readFileSync(new URL('./ci-workflow-baseline.json', import.meta.url), 'utf8'),
);
const runner = 'node scripts/ci-run-selected.mjs';
const planEnv = 'CI_IMPACT_PLAN: ${{ needs.impact.outputs.plan }}';
const browserSelected =
  '${{ fromJSON(needs.impact.outputs.plan).selection.browser.quality[0] != null }}';
const scoped = "${{ fromJSON(needs.impact.outputs.plan).mode == 'scoped' }}";
const compileSelected =
  '${{ fromJSON(needs.impact.outputs.plan).selection.typecheck == true }}';

// This narrow checked-in-workflow contract reader is intentionally not a YAML
// parser. Unexpected layout or duplicate job IDs fail instead of hiding a gate.
function jobBodies(source) {
  assert.equal(source.split('\njobs:\n').length, 2);
  const body = source.split('\njobs:\n')[1];
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
function runCommands(body) {
  return [...body.matchAll(/^      - run: (.*)$/gm)].map((match) => match[1]);
}
function guarded(body, command, condition) {
  assert.ok(
    body.includes(`      - run: ${command}\n        if: ${condition}\n`),
    `Missing explicit guard for ${command}`,
  );
}
function ordered(body, entries) {
  let previous = -1;
  for (const entry of entries) {
    const index = body.indexOf(entry, previous + 1);
    assert.ok(index > previous, `Missing/out-of-order gate: ${entry}`);
    previous = index;
  }
}
function selectedJob(name, body) {
  assert.match(body, /^    needs: impact$/m);
  assert.ok(
    body.includes(
      `if: \${{ needs.impact.result == 'success' && fromJSON(needs.impact.outputs.plan).jobs['${name}'] }}`,
    ),
  );
  assert.ok(body.includes(planEnv));
}
function noBlanketExecution(source) {
  assert.doesNotMatch(
    source,
    /(?:run:|&&|\|\|)\s*(?:npm run (?:check:all|lint\b|test(?::|\s|$))|npx (?:vitest|playwright test)|node --test|node scripts\/test-)/m,
  );
  assert.doesNotMatch(source, /continue-on-error:|\|\|\s*(?:true|:)|set \+e/);
}
function qualityContract(body) {
  assert.match(body, /^    needs: impact$/m);
  assert.match(
    body,
    /^    if: \$\{\{ needs\.impact\.result == 'success' \}\}$/m,
  );
  assert.ok(body.includes(planEnv));
  assert.deepEqual(runCommands(body), [
    'npm ci',
    `${runner} lint`,
    'npm run typecheck',
    `${runner} unit`,
    `${runner} fixtures`,
    'npm run build',
    'npx playwright install --with-deps chromium',
    `${runner} browser quality`,
  ]);
  guarded(body, 'npm ci', scoped);
  guarded(body, 'npm run typecheck', compileSelected);
  for (const command of [
    'npm run build',
    'npx playwright install --with-deps chromium',
    `${runner} browser quality`,
  ])
    guarded(body, command, browserSelected);
  assert.ok(
    body.includes(
      'uses: actions/upload-artifact@v4\n' +
        '        if: ${{ always() && fromJSON(needs.impact.outputs.plan).selection.browser.quality[0] != null }}\n',
    ),
  );
}
function databaseContract(body) {
  selectedJob('database', body);
  assert.deepEqual(runCommands(body), [
    'npm ci',
    'npm run db:start',
    'npm run db:reset',
    'npm run db:lint',
    `${runner} sql`,
    `${runner} sql`,
    `${runner} races`,
    `${runner} upgrades`,
    'npm run db:types',
    'npm run typecheck',
    'npm run db:stop -- --no-backup',
  ]);
  ordered(body, [
    'run: npm run db:types',
    'uses: actions/upload-artifact@v4\n        if: success()',
    'name: database-types',
    'path: src/types/database.ts',
    'if-no-files-found: error',
    'run: npm run typecheck',
    'git ls-files --error-unmatch src/types/database.ts',
    'git diff --exit-code -- src/types/database.ts',
    'run: npm run db:stop -- --no-backup\n        if: always()',
  ]);
  assert.match(body, /timeout-minutes: 35/);
}

const developmentServers = new Set([
  'enrollment-browser',
  'renewal-browser',
  'cancellation-browser',
  'reconciliation-browser',
]);
function browserCommands(name) {
  const feature = name.replace(/-browser$/, '');
  const environments = ['auth'];
  if (developmentServers.has(name)) {
    for (const prerequisite of [
      'enrollment',
      'renewal',
      'cancellation',
      'reconciliation',
    ]) {
      environments.push(prerequisite);
      if (prerequisite === feature) break;
    }
  } else if (feature === 'speech') environments.push('reply', 'speech');
  else if (feature !== 'auth') environments.push(feature);
  return [
    'npm ci',
    'node scripts/auth-local-ci.mjs configure',
    'npm run db:start',
    'npm run db:reset',
    ...environments.map(
      (item) => `node scripts/${item}-local-ci.mjs environment`,
    ),
    ...(!developmentServers.has(name) ? ['npm run build'] : []),
    'npx playwright install --with-deps chromium',
    `${runner} browser ${name}`,
    'npm run db:stop -- --no-backup',
  ];
}
function browserContract(name, body) {
  selectedJob(name, body);
  assert.deepEqual(runCommands(body), browserCommands(name));
  ordered(body, [
    `run: ${runner} browser ${name}`,
    'uses: actions/upload-artifact@v4\n        if: always()',
    `name: ${name}-results`,
    'playwright-report/',
    'test-results/',
    'retention-days: 7',
    'run: npm run db:stop -- --no-backup\n        if: always()',
  ]);
  assert.match(body, /NEXT_TELEMETRY_DISABLED: '1'/);
  assert.match(body, /timeout-minutes: (?:20|25)/);
}

// Historical browser setup hashes remain immutable. Reconstruct ONLY the old
// suite command to prove all fixture/build/artifact/teardown bytes are retained.
// This never executes the old suite or requires cumulative regression coverage.
function preservedBrowserSetup(name, body) {
  const steps = body.split('    steps:\n')[1];
  assert.ok(steps);
  const originalCommand =
    name === 'auth-browser'
      ? 'npx playwright test --config playwright.auth.config.ts'
      : `npm run test:e2e:${name === 'reply-browser' ? 'replies' : name.replace(/-browser$/, '')}`;
  const original = steps.replace(
    `run: ${runner} browser ${name}\n`,
    `run: ${originalCommand}\n`,
  );
  assert.equal(
    createHash('sha256').update(original).digest('hex'),
    baseline.stepHashes[name],
    `${name}: guarded fixture setup/artifact/teardown changed`,
  );
}

describe('explicit changed-work-only CI workflow', () => {
  it('has PR-only automatic triggers and no manual or merge/push fallback', () => {
    const trigger = workflow.split('\npermissions:\n')[0];
    assert.deepEqual(
      [...trigger.matchAll(/^  ([a-z_]+):$/gm)].map((match) => match[1]),
      ['pull_request'],
    );
    assert.match(
      trigger,
      /branches: \[develop, main, 'release\/\*\*', 'releases\/\*\*'\]/,
    );
    assert.match(trigger, /types: \[opened, synchronize, reopened, edited\]/);
  });

  it('remains fork-safe, read-only, and without workflow-level path filters', () => {
    assert.match(workflow, /permissions:\n  contents: read\n/);
    assert.doesNotMatch(
      workflow,
      /pull_request_target|secrets\.|(?:^|\n) *paths(?:-ignore)?:|(?:pull-requests|checks|actions|id-token): write/,
    );
  });

  it('preserves the complete stable job and aggregate inventory', () => {
    assert.deepEqual(
      Object.keys(jobs).sort(),
      [...REQUIRED_JOB_IDS, 'ci-required'].sort(),
    );
    const needs = jobs['ci-required']
      .split('    needs:\n')[1]
      ?.split('    runs-on:')[0];
    assert.ok(needs);
    assert.deepEqual(
      [...needs.matchAll(/^      - ([a-z-]+)$/gm)].map((m) => m[1]).sort(),
      [...REQUIRED_JOB_IDS].sort(),
    );
    assert.match(jobs['ci-required'], /^    if: \$\{\{ always\(\) \}\}$/m);
    assert.ok(jobs['ci-required'].includes(planEnv));
    assert.match(jobs['ci-required'], /CI_NEEDS: \$\{\{ toJSON\(needs\) \}\}/);
    assert.match(jobs['ci-required'], /run: node scripts\/ci-required\.mjs/);
  });

  it('computes one plan before selected tests with no blanket bootstrap tests', () => {
    assert.deepEqual(runCommands(jobs.impact), []);
    assert.match(
      jobs.impact,
      /id: select\n        run: node scripts\/ci-impact\.mjs/,
    );
    assert.match(jobs.impact, /fetch-depth: 0/);
    assert.match(jobs.impact, /persist-credentials: false/);
    assert.match(jobs.impact, /plan: \$\{\{ steps\.select\.outputs\.plan \}\}/);
    assert.doesNotMatch(jobs.impact, /--test|npm ci|ci-run-selected/);
  });

  it('has no cumulative test/lint invocation or failure masking anywhere', () => {
    noBlanketExecution(workflow);
  });

  it('passes the validated plan and exact explicit job gate to all expensive jobs', () => {
    for (const name of CONDITIONAL_JOBS) selectedJob(name, jobs[name]);
  });

  it('runs only selected quality work, compiles explicitly, builds only selected browser work', () => {
    qualityContract(jobs.quality);
  });

  it('retains genuine schema setup/types but only two selected SQL passes and selected races/upgrades', () => {
    databaseContract(jobs.database);
  });

  for (const name of BROWSER_JOBS) {
    it(`${name}: retains isolated fixture lifecycle and only invokes its named browser selection`, () => {
      browserContract(name, jobs[name]);
      if (name in baseline.stepHashes) preservedBrowserSetup(name, jobs[name]);
    });
  }

  it('keeps historical setup evidence immutable without requiring historical tests', () => {
    assert.equal(baseline.commit, '4b4a9f55de1fb5c61302dcf0fc28d42eae570f65');
    assert.equal(Object.keys(baseline.stepHashes).length, 21);
    assert.ok(Object.keys(baseline.stepHashes).every((name) => name in jobs));
  });

  for (const command of [
    'npm run check:all',
    'npm run test',
    'npm run test:integration',
    'npm run test:e2e:analytics-funnel',
    'npm run test:analytics-funnel-fixture',
    'npm run lint',
    'node --test scripts/ci-*.test.mjs',
    'npx vitest run',
    'npx playwright test',
    'node scripts/test-analytics-funnel-concurrency.mjs',
  ]) {
    it(`rejects bypassing the explicit runner with ${command}`, () => {
      assert.throws(() =>
        noBlanketExecution(`${workflow}\n      - run: ${command}\n`),
      );
    });
  }

  it('rejects removing, duplicating, or weakening selected database gates', () => {
    for (const command of [
      `${runner} sql`,
      `${runner} races`,
      `${runner} upgrades`,
      'npm run db:lint',
      'npm run db:types',
    ]) {
      const line = `      - run: ${command}\n`;
      for (const replacement of [
        '',
        line + line,
        '      - run: echo bypassed\n',
      ])
        assert.throws(() =>
          databaseContract(jobs.database.replace(line, replacement)),
        );
    }
  });

  it('rejects quality build/install/browser work without its nonempty selection gate', () => {
    for (const command of [
      'npm ci',
      'npm run typecheck',
      'npm run build',
      'npx playwright install --with-deps chromium',
      `${runner} browser quality`,
    ]) {
      const prefix = `      - run: ${command}\n`;
      const start = jobs.quality.indexOf(prefix) + prefix.length;
      const end = jobs.quality.indexOf('\n', start) + 1;
      const unguarded = jobs.quality.slice(0, start) + jobs.quality.slice(end);
      assert.throws(() => qualityContract(unguarded));
    }
  });

  it('rejects lost cleanup, fixture guards, plan or narrowed execution in a browser job', () => {
    const name = 'analytics-funnel-browser';
    const body = jobs[name];
    for (const changed of [
      body.replace('node scripts/auth-local-ci.mjs configure', 'echo bypassed'),
      body.replace(
        'node scripts/analytics-funnel-local-ci.mjs environment',
        'echo bypassed',
      ),
      body.replace(planEnv, ''),
      body.replace(
        `${runner} browser ${name}`,
        'npm run test:e2e:analytics-funnel',
      ),
      body.replace(
        'run: npm run db:stop -- --no-backup\n        if: always()',
        'run: npm run db:stop -- --no-backup',
      ),
      body.replace(
        'uses: actions/upload-artifact@v4\n        if: always()',
        'uses: actions/upload-artifact@v4',
      ),
    ])
      assert.throws(() => browserContract(name, changed));
  });

  it('rejects failure suppression and duplicate job definitions', () => {
    for (const suffix of [
      'continue-on-error: true',
      'run: false || true',
      'run: set +e',
    ])
      assert.throws(() => noBlanketExecution(workflow + '\n' + suffix));
    assert.throws(() =>
      jobBodies(workflow + '\n  quality:\n    runs-on: ubuntu-latest\n'),
    );
  });
});
