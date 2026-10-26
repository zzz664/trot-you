import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  ACTIVITY_REWARDS_CI_ENV,
  activityRewardsLocalEnvironment,
} from './activity-rewards-local-config.mjs';

const fixture = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  AUTH_LOCAL_E2E: 'true',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  AUTH_TEST_SERVICE_KEY: 'fictional-local-fixture-key',
  SUPABASE_SERVICE_ROLE_KEY: 'fictional-local-fixture-key',
};
test('local activity-rewards opt-in writes only disabled delivery and payment settings, never fixture credentials', () => {
  assert.equal(
    activityRewardsLocalEnvironment(fixture),
    'ACTIVITY_REWARDS_LOCAL_E2E=true\n' +
      Object.entries(ACTIVITY_REWARDS_CI_ENV)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
  );
});
test('exact Auth-only placeholders are cleared before the activity browser build', () => {
  const output = activityRewardsLocalEnvironment({
    ...fixture,
    PAYMENTS_MODE: 'test',
    TOSS_BILLING_ENABLED: 'true',
    KAKAOPAY_SUBSCRIPTION_ENABLED: 'true',
    NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_ck_checkout_ci_fixture',
    TOSS_SECRET_KEY: 'test_sk_checkout_ci_fixture',
    TOSS_BILLING_MID: 'checkout_ci_fictional_mid',
    KAKAOPAY_SECRET_KEY: 'checkout_ci_not_a_real_key',
    KAKAOPAY_RECURRING_CID: 'TCSUBSCRIP',
    KAKAOPAY_CID_SECRET: '',
  });
  assert.match(output, /PAYMENTS_MODE=disabled\n/);
  assert.match(output, /TOSS_BILLING_ENABLED=false\n/);
  assert.match(output, /KAKAOPAY_SUBSCRIPTION_ENABLED=false\n/);
  assert.match(output, /TOSS_SECRET_KEY=\n/);
  assert.match(output, /KAKAOPAY_SECRET_KEY=\n/);
  assert.doesNotMatch(
    output,
    /test_sk_checkout_ci_fixture|checkout_ci_not_a_real_key/,
  );
});
for (const key of [
  'CI',
  'GITHUB_ACTIONS',
  'AUTH_LOCAL_E2E',
  'AUTH_TEST_SERVICE_KEY',
])
  test(`missing ${key} rejects activity-rewards fixture activation`, () => {
    assert.throws(() =>
      activityRewardsLocalEnvironment({ ...fixture, [key]: undefined }),
    );
  });
for (const [key, value] of [
  ['NEXT_PUBLIC_APP_URL', 'https://example.invalid'],
  ['NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co'],
  ['NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321/evil'],
  ['DOCKER_HOST', 'tcp://remote.invalid'],
  ['DOCKER_CONTEXT', 'remote'],
  ['SUPABASE_ACCESS_TOKEN', 'secret-hosted-token'],
  ['SUPABASE_DB_PASSWORD', 'secret-hosted-password'],
  ['ACTIVITY_REWARDS_LOCAL_E2E', 'true'],
  ['SCHEDULE_NOTICES_ENABLED', 'true'],
  ['SCHEDULE_NOTICES_CRON_SECRET', 'unknown'],
  ['MESSAGE_DISPATCH_ENABLED', 'true'],
  ['MESSAGE_DISPATCH_CRON_SECRET', 'unknown'],
  ['BILLING_NOTICES_ENABLED', 'true'],
  ['BILLING_NOTICES_CRON_SECRET', 'unknown'],
  ['WEBPUSH_WORKER_ENABLED', 'true'],
  ['PAYMENTS_MODE', 'live'],
  ['TOSS_SECRET_KEY', 'live_sk_not_allowed'],
  ['KAKAOPAY_SECRET_KEY', 'unapproved-key'],
  ['VAPID_PRIVATE_KEY', 'unapproved-key'],
  ['PAYMENTS_RENEWALS_ENABLED', 'true'],
  ['PAYMENTS_REFUNDS_ENABLED', 'true'],
  ['PAYMENTS_RECONCILIATION_ENABLED', 'true'],
])
  test(`${key} override rejects before any file write or network call`, () => {
    assert.throws(() =>
      activityRewardsLocalEnvironment({ ...fixture, [key]: value }),
    );
  });
test('a credential mismatch error does not expose either key', () => {
  const first = 'private-service-value';
  const second = 'private-fixture-value';
  assert.throws(
    () =>
      activityRewardsLocalEnvironment({
        ...fixture,
        SUPABASE_SERVICE_ROLE_KEY: first,
        AUTH_TEST_SERVICE_KEY: second,
      }),
    (error) =>
      !String(error).includes(first) && !String(error).includes(second),
  );
});

test('default discovery excludes the isolated activity-rewards suite', async () => {
  const { execFileSync } = await import('node:child_process');
  const listing = execFileSync(
    process.execPath,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--list',
      '--reporter=line',
    ],
    { encoding: 'utf8', timeout: 30_000 },
  );
  assert.match(listing, /Total: [1-9][0-9]* tests/);
  assert.doesNotMatch(listing, /activity-rewards\/activity-rewards\.spec/);
});
test('dedicated activity-rewards discovery fails closed without its local opt-in', async () => {
  const { execFileSync } = await import('node:child_process');
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          'node_modules/@playwright/test/cli.js',
          'test',
          '--config',
          'playwright.activity-rewards.config.ts',
          '--list',
        ],
        {
          encoding: 'utf8',
          timeout: 30_000,
          env: {
            ...process.env,
            ACTIVITY_REWARDS_LOCAL_E2E: '',
            AUTH_LOCAL_E2E: '',
          },
          stdio: 'pipe',
        },
      ),
    (error) => /Run activity-rewards tests only/.test(String(error.stderr)),
  );
});
test('opted-in discovery lists activity-rewards tests without launching a browser, server or database', async () => {
  const { execFileSync } = await import('node:child_process');
  const listing = execFileSync(
    process.execPath,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--config',
      'playwright.activity-rewards.config.ts',
      '--list',
      '--reporter=line',
    ],
    {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        ...fixture,
        ...ACTIVITY_REWARDS_CI_ENV,
        ACTIVITY_REWARDS_LOCAL_E2E: 'true',
      },
    },
  );
  assert.match(listing, /activity-rewards\.spec\.ts/);
  assert.match(listing, /Total: [1-9][0-9]* tests in 1 file/);
  assert.doesNotMatch(
    listing,
    /(?:auth-unconfigured|activity-rewards-unconfigured|speech|media|replies)\.spec\.ts:/,
  );
});

test('arrival checks the real current-actor snapshot before forwarding and navigation listeners precede clicks', () => {
  const source = readFileSync(
    new URL(
      '../tests/e2e/activity-rewards/activity-rewards.spec.ts',
      import.meta.url,
    ),
    'utf8',
  );
  const observer = source
    .split('async function captureArrival(')[1]
    ?.split('async function openActivity(')[0];
  assert.ok(observer);
  const checks = [
    "expect(request.method()).toBe('GET')",
    'expect(url.pathname + url.search).toBe(routes.activityRewardsApi)',
    'expect(request.headers()[ACTIVITY_REWARDS.actorHeader]).toBe(actor.id)',
    'const response = await route.fetch()',
    'activitySnapshotSchema.parse(await success(response))',
    'expect(data.actor_id).toBe(actor.id)',
    'await route.fulfill({ response })',
    'accept()',
  ];
  let previous = -1;
  for (const check of checks) {
    const index = observer.indexOf(check);
    assert.ok(
      index > previous,
      `Missing or reordered arrival verification: ${check}`,
    );
    previous = index;
  }
  const compact = source.replace(/\s+/g, '');
  const listen = compact.indexOf(
    'constnavigation=navigationResponse(page,routes.activityRewards)',
  );
  const click = compact.indexOf(
    "awaitpage.getByRole('link',{name:copy.entryOpen,exact:true}).click()",
  );
  assert.ok(listen >= 0 && click > listen);
  assert.ok(
    source.includes('const response = await page.goto(routes.activityRewards)'),
  );
  assert.ok(source.includes('expect(response?.status()).toBe(200)'));
  assert.ok(!source.includes('waitForTimeout'));
});

test('activity errors are scoped to application main, not the Next route announcer', () => {
  const source = readFileSync(
    new URL(
      '../tests/e2e/activity-rewards/activity-rewards.spec.ts',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(source, /page\.getByRole\('main'\)\.getByRole\('alert'\)/);
  assert.doesNotMatch(source, /page\.getByRole\('alert'\)/);
  assert.equal(
    (source.match(/expect\(activityAlert\(page\)\)/g) ?? []).length,
    4,
  );
});

test('real comment API fixture includes the URL target and satisfies its strict input contract', () => {
  const source = readFileSync(
    new URL(
      '../tests/e2e/activity-rewards/activity-rewards.spec.ts',
      import.meta.url,
    ),
    'utf8',
  );
  const comment = source
    .split('const comment = {')[1]
    ?.split('const created =')[0];
  assert.ok(comment);
  assert.match(comment, /post_id: post\.post_id/);
  assert.match(comment, /satisfies CommunityCommentCreateInput/);
  assert.match(
    source,
    /communityCommentsPath\(world\.artist\.slug, post\.post_id\)/,
  );
});

test('late verified reads finish their terminal handler before assertions and teardown', () => {
  const source = readFileSync(
    new URL(
      '../tests/e2e/activity-rewards/activity-rewards.spec.ts',
      import.meta.url,
    ),
    'utf8',
  )
    .split("test('a late verified response")[1]
    ?.split("test('HTML, RSC")[0];
  assert.ok(source);
  assert.match(
    source,
    /await route\.fulfill\(\{ response \}\);\s*settled\(\{\}\)/,
  );
  assert.match(
    source,
    /if \(!terminalActionStarted\) \{\s*try \{\s*await route\.abort\(\)/,
  );
  assert.match(source, /new AggregateError\(\s*\[error, abortError\]/);
  assert.ok(
    source.indexOf('settled({ error: failure })') >
      source.indexOf('await route.abort()'),
  );
  assert.doesNotMatch(source, /\.catch\(/);
  const release = source.indexOf('release();');
  const join = source.indexOf('const completion = await completed;');
  const ledger = source.indexOf('expect(ledger(world.fan))');
  assert.ok(release >= 0 && join > release && ledger > join);
  assert.match(source, /if \('error' in completion\) throw completion\.error/);
});

test('back navigation waits for the destination commit and verifies the return response', () => {
  const source = readFileSync(
    new URL(
      '../tests/e2e/activity-rewards/activity-rewards.spec.ts',
      import.meta.url,
    ),
    'utf8',
  ).split("test('HTML, RSC")[1];
  assert.ok(source);
  const checks = [
    'expect((await navigation).status()).toBe(200)',
    'await expect(page).toHaveURL(routes.points)',
    'name: messages.attendancePoints.title',
    'const arrival = await captureArrival(page, world.fan)',
    'await page.goBack()',
    'await expect(page).toHaveURL(routes.activityRewards)',
    'await arrival.result',
    'await expect(entries(page)).toHaveCount(3)',
  ];
  let previous = -1;
  for (const check of checks) {
    const index = source.indexOf(check);
    assert.ok(
      index > previous,
      `Missing or reordered back navigation guard: ${check}`,
    );
    previous = index;
  }
});
