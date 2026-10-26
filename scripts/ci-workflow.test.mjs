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

// The historical hashes stay immutable. Feature33 adds these exact gates;
// removing only their reviewed insertion blocks must recover every old byte.
const reviewedAdditions = {
  quality: [
    {
      before: '      - run: npx playwright install --with-deps chromium\n',
      text:
        '      - run: npm run test:content-calendar-fixture\n' +
        '      - run: npm run test:community-posts-fixture\n' +
        '      - run: npm run test:community-interactions-fixture\n' +
        '      - run: npm run test:community-moderation-fixture\n' +
        '      - run: npm run test:attendance-points-fixture\n',
    },
  ],
  database: [
    {
      before: '      - run: npm run db:types\n',
      text:
        '      - run: npm run test:db:content-calendar-concurrency\n' +
        '      - run: node scripts/test-content-calendar-upgrade.mjs\n' +
        '      - run: npm run test:db:community-posts-concurrency\n' +
        '      - run: node scripts/test-community-posts-upgrade.mjs\n' +
        '      - run: npm run test:db:community-interactions-concurrency\n' +
        '      - run: node scripts/test-community-interactions-upgrade.mjs\n' +
        '      - run: npm run test:db:community-moderation-concurrency\n' +
        '      - run: node scripts/test-community-moderation-upgrade.mjs\n' +
        '      - run: npm run test:db:attendance-points-concurrency\n' +
        '      - run: node scripts/test-attendance-points-upgrade.mjs\n',
    },
  ],
};
function originalSteps(name, steps) {
  let original = steps;
  for (const { before, text } of reviewedAdditions[name] ?? []) {
    const insertion = `${text}${before}`;
    assert.equal(
      original.split(insertion).length,
      2,
      `${name}: reviewed gates missing, duplicated or moved`,
    );
    original = original.replace(insertion, before);
  }
  return original;
}
function verifyLegacySteps(name, body) {
  const steps = body.split('    steps:\n')[1];
  assert.ok(steps, `${name}: missing legacy steps`);
  assert.equal(
    createHash('sha256').update(originalSteps(name, steps)).digest('hex'),
    baseline.stepHashes[name],
    `${name}: original setup/test/cleanup/artifact steps changed`,
  );
}

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

  it('preserves all 21 original job steps with only exact reviewed additions', () => {
    assert.equal(baseline.commit, '4b4a9f55de1fb5c61302dcf0fc28d42eae570f65');
    // This historical snapshot is fixed at 21 jobs. A future additional suite
    // belongs in the registry/aggregate, not falsely in this old commit's data.
    assert.equal(Object.keys(baseline.stepHashes).length, 21);
    assert.ok(Object.keys(baseline.stepHashes).every((name) => name in jobs));
    for (const name of Object.keys(baseline.stepHashes)) {
      verifyLegacySteps(name, jobs[name]);
    }
  });

  it('rejects missing, duplicated, relocated or weakened reviewed DB gates', () => {
    const original = jobs.database;
    const added = reviewedAdditions.database[0].text;
    for (const changed of [
      original.replace(added, ''),
      original.replace(added, added + added),
      original
        .replace(added, '')
        .replace(
          '      - run: npm run db:reset\n',
          `      - run: npm run db:reset\n${added}`,
        ),
      original.replace(
        'npm run test:db:content-calendar-concurrency',
        'echo skipped calendar races',
      ),
      original.replace(
        'node scripts/test-content-calendar-upgrade.mjs',
        'echo skipped calendar upgrade',
      ),
      original.replace(
        'npm run test:db:community-moderation-concurrency',
        'echo skipped moderation races',
      ),
      original.replace(
        'node scripts/test-community-moderation-upgrade.mjs',
        'echo skipped moderation upgrade',
      ),
      original.replace(
        'npm run test:db:attendance-points-concurrency',
        'echo skipped attendance races',
      ),
      original.replace(
        'node scripts/test-attendance-points-upgrade.mjs',
        'echo skipped attendance upgrade',
      ),
      original.replace(
        'npm run test:integration',
        'echo skipped original integration',
      ),
      original.replace('npm run db:lint', 'echo skipped original lint'),
      original.replace(
        'npm run test:db:community-posts-concurrency',
        'echo skipped board races',
      ),
      original.replace(
        'node scripts/test-community-posts-upgrade.mjs',
        'echo skipped board upgrade',
      ),
      original.replace(
        'npm run test:db:community-interactions-concurrency',
        'echo skipped interaction races',
      ),
      original.replace(
        'node scripts/test-community-interactions-upgrade.mjs',
        'echo skipped interaction upgrade',
      ),
    ])
      assert.throws(() => verifyLegacySteps('database', changed));
  });

  it('rejects missing, duplicated, relocated or weakened reviewed fixture gates', () => {
    const original = jobs.quality;
    const added = reviewedAdditions.quality[0].text;
    for (const changed of [
      original.replace(added, ''),
      original.replace(added, added + added),
      original
        .replace(added, '')
        .replace('      - run: npm ci\n', `      - run: npm ci\n${added}`),
      original.replace(
        'npm run test:content-calendar-fixture',
        'echo skipped calendar fixtures',
      ),
      original.replace(
        'npm run test:attendance-points-fixture',
        'echo skipped attendance fixture',
      ),
      original.replace(
        'npm run test:community-moderation-fixture',
        'echo skipped moderation fixtures',
      ),
      original.replace('npm run check:all', 'echo skipped original quality'),
      original.replace(
        'npm run test:community-posts-fixture',
        'echo skipped board fixtures',
      ),
      original.replace(
        'npm run test:community-interactions-fixture',
        'echo skipped interaction fixtures',
      ),
    ])
      assert.throws(() => verifyLegacySteps('quality', changed));
  });

  it('runs the registered calendar suite in its isolated Auth/database fixture job', () => {
    const calendar = jobs['content-calendar-browser'];
    const required = [
      'run: node scripts/auth-local-ci.mjs configure',
      'run: npm run db:start',
      'run: npm run db:reset',
      'run: node scripts/auth-local-ci.mjs environment',
      'run: node scripts/content-calendar-local-ci.mjs environment',
      'run: npm run build',
      'run: npx playwright install --with-deps chromium',
      'run: npm run test:e2e:content-calendar',
      'uses: actions/upload-artifact@v4',
      'name: content-calendar-browser-results',
      'run: npm run db:stop -- --no-backup',
    ];
    let previous = -1;
    for (const gate of required) {
      const index = calendar.indexOf(gate);
      assert.ok(
        index > previous,
        `Calendar gate missing or out of order: ${gate}`,
      );
      previous = index;
    }
    assert.match(
      calendar,
      /run: npm run db:stop -- --no-backup\n        if: always\(\)/,
    );
    assert.match(
      calendar,
      /uses: actions\/upload-artifact@v4\n        if: always\(\)/,
    );
    assert.match(calendar, /timeout-minutes: 25/);
    const config = readFileSync(
      new URL('../playwright.config.ts', import.meta.url),
      'utf8',
    );
    assert.ok(config.includes("'**/content-calendar/**'"));
    const scripts = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ).scripts;
    assert.equal(
      scripts['test:e2e:content-calendar'],
      'playwright test --config playwright.content-calendar.config.ts',
    );
    assert.equal(
      scripts['test:content-calendar-fixture'],
      'node --test scripts/content-calendar-local-config.test.mjs',
    );
    assert.equal(
      scripts['test:db:content-calendar-concurrency'],
      'node scripts/test-content-calendar-concurrency.mjs',
    );
  });

  it('runs the registered community board suite in its isolated Auth/database fixture job', () => {
    const calendar = jobs['community-posts-browser'];
    const required = [
      'run: node scripts/auth-local-ci.mjs configure',
      'run: npm run db:start',
      'run: npm run db:reset',
      'run: node scripts/auth-local-ci.mjs environment',
      'run: node scripts/community-posts-local-ci.mjs environment',
      'run: npm run build',
      'run: npx playwright install --with-deps chromium',
      'run: npm run test:e2e:community-posts',
      'uses: actions/upload-artifact@v4',
      'name: community-posts-browser-results',
      'run: npm run db:stop -- --no-backup',
    ];
    let previous = -1;
    for (const gate of required) {
      const index = calendar.indexOf(gate);
      assert.ok(
        index > previous,
        `Community board gate missing or out of order: ${gate}`,
      );
      previous = index;
    }
    assert.match(
      calendar,
      /run: npm run db:stop -- --no-backup\n        if: always\(\)/,
    );
    assert.match(
      calendar,
      /uses: actions\/upload-artifact@v4\n        if: always\(\)/,
    );
    assert.match(calendar, /timeout-minutes: 25/);
    const config = readFileSync(
      new URL('../playwright.config.ts', import.meta.url),
      'utf8',
    );
    assert.ok(config.includes("'**/community-posts/**'"));
    const scripts = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ).scripts;
    assert.equal(
      scripts['test:e2e:community-posts'],
      'playwright test --config playwright.community-posts.config.ts',
    );
    assert.equal(
      scripts['test:community-posts-fixture'],
      'node --test scripts/community-posts-local-config.test.mjs',
    );
    assert.equal(
      scripts['test:db:community-posts-concurrency'],
      'node scripts/test-community-posts-concurrency.mjs',
    );
  });

  it('runs the registered community interaction suite in its isolated Auth/database fixture job', () => {
    const calendar = jobs['community-interactions-browser'];
    const required = [
      'run: node scripts/auth-local-ci.mjs configure',
      'run: npm run db:start',
      'run: npm run db:reset',
      'run: node scripts/auth-local-ci.mjs environment',
      'run: node scripts/community-interactions-local-ci.mjs environment',
      'run: npm run build',
      'run: npx playwright install --with-deps chromium',
      'run: npm run test:e2e:community-interactions',
      'uses: actions/upload-artifact@v4',
      'name: community-interactions-browser-results',
      'run: npm run db:stop -- --no-backup',
    ];
    let previous = -1;
    for (const gate of required) {
      const index = calendar.indexOf(gate);
      assert.ok(
        index > previous,
        `Community interaction gate missing or out of order: ${gate}`,
      );
      previous = index;
    }
    assert.match(
      calendar,
      /run: npm run db:stop -- --no-backup\n        if: always\(\)/,
    );
    assert.match(
      calendar,
      /uses: actions\/upload-artifact@v4\n        if: always\(\)/,
    );
    assert.match(calendar, /timeout-minutes: 25/);
    const config = readFileSync(
      new URL('../playwright.config.ts', import.meta.url),
      'utf8',
    );
    assert.ok(config.includes("'**/community-interactions/**'"));
    const scripts = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ).scripts;
    assert.equal(
      scripts['test:e2e:community-interactions'],
      'playwright test --config playwright.community-interactions.config.ts',
    );
    assert.equal(
      scripts['test:community-interactions-fixture'],
      'node --test scripts/community-interactions-local-config.test.mjs',
    );
    assert.equal(
      scripts['test:db:community-interactions-concurrency'],
      'node scripts/test-community-interactions-concurrency.mjs',
    );
  });

  it('runs the registered community moderation suite in its isolated Auth/database fixture job', () => {
    const calendar = jobs['community-moderation-browser'];
    const required = [
      'run: node scripts/auth-local-ci.mjs configure',
      'run: npm run db:start',
      'run: npm run db:reset',
      'run: node scripts/auth-local-ci.mjs environment',
      'run: node scripts/community-moderation-local-ci.mjs environment',
      'run: npm run build',
      'run: npx playwright install --with-deps chromium',
      'run: npm run test:e2e:community-moderation',
      'uses: actions/upload-artifact@v4',
      'name: community-moderation-browser-results',
      'run: npm run db:stop -- --no-backup',
    ];
    let previous = -1;
    for (const gate of required) {
      const index = calendar.indexOf(gate);
      assert.ok(
        index > previous,
        `Community moderation gate missing or out of order: ${gate}`,
      );
      previous = index;
    }
    assert.match(
      calendar,
      /run: npm run db:stop -- --no-backup\n        if: always\(\)/,
    );
    assert.match(
      calendar,
      /uses: actions\/upload-artifact@v4\n        if: always\(\)/,
    );
    assert.match(calendar, /timeout-minutes: 25/);
    const config = readFileSync(
      new URL('../playwright.config.ts', import.meta.url),
      'utf8',
    );
    assert.ok(config.includes("'**/community-moderation/**'"));
    const scripts = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ).scripts;
    assert.equal(
      scripts['test:e2e:community-moderation'],
      'playwright test --config playwright.community-moderation.config.ts',
    );
    assert.equal(
      scripts['test:community-moderation-fixture'],
      'node --test scripts/community-moderation-local-config.test.mjs',
    );
    assert.equal(
      scripts['test:db:community-moderation-concurrency'],
      'node scripts/test-community-moderation-concurrency.mjs',
    );
  });

  it('runs the registered attendance points suite in its isolated Auth/database fixture job', () => {
    const calendar = jobs['attendance-points-browser'];
    const required = [
      'run: node scripts/auth-local-ci.mjs configure',
      'run: npm run db:start',
      'run: npm run db:reset',
      'run: node scripts/auth-local-ci.mjs environment',
      'run: node scripts/attendance-points-local-ci.mjs environment',
      'run: npm run build',
      'run: npx playwright install --with-deps chromium',
      'run: npm run test:e2e:attendance-points',
      'uses: actions/upload-artifact@v4',
      'name: attendance-points-browser-results',
      'run: npm run db:stop -- --no-backup',
    ];
    let previous = -1;
    for (const gate of required) {
      const index = calendar.indexOf(gate);
      assert.ok(
        index > previous,
        `Attendance points gate missing or out of order: ${gate}`,
      );
      previous = index;
    }
    assert.match(
      calendar,
      /run: npm run db:stop -- --no-backup\n        if: always\(\)/,
    );
    assert.match(
      calendar,
      /uses: actions\/upload-artifact@v4\n        if: always\(\)/,
    );
    assert.match(calendar, /timeout-minutes: 25/);
    const config = readFileSync(
      new URL('../playwright.config.ts', import.meta.url),
      'utf8',
    );
    assert.ok(config.includes("'**/attendance-points/**'"));
    const scripts = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ).scripts;
    assert.equal(
      scripts['test:e2e:attendance-points'],
      'playwright test --config playwright.attendance-points.config.ts',
    );
    assert.equal(
      scripts['test:attendance-points-fixture'],
      'node --test scripts/attendance-points-local-config.test.mjs',
    );
    assert.equal(
      scripts['test:db:attendance-points-concurrency'],
      'node scripts/test-attendance-points-concurrency.mjs',
    );
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
      33,
    );
    assert.equal(
      (database.match(/run: node scripts\/test-[^\n]*upgrade\.mjs\n/g) || [])
        .length,
      9,
    );
    assert.match(database, /git diff --exit-code -- src\/types\/database\.ts/);
    assert.match(database, /npm run db:lint/);
    assert.match(database, /npm run typecheck/);
    assert.match(database, /timeout-minutes: 30/);
  });
});
