import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  COMMUNITY_MODERATION_CI_ENV,
  communityModerationLocalEnvironment,
} from './community-moderation-local-config.mjs';

const fixture = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  AUTH_LOCAL_E2E: 'true',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  AUTH_TEST_SERVICE_KEY: 'fictional-local-fixture-key',
  SUPABASE_SERVICE_ROLE_KEY: 'fictional-local-fixture-key',
};
test('local community-moderation opt-in writes only disabled delivery and payment settings, never fixture credentials', () => {
  assert.equal(
    communityModerationLocalEnvironment(fixture),
    'COMMUNITY_MODERATION_LOCAL_E2E=true\n' +
      Object.entries(COMMUNITY_MODERATION_CI_ENV)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
  );
});
test('exact Auth-only placeholders are cleared before the community browser build', () => {
  const output = communityModerationLocalEnvironment({
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
  test(`missing ${key} rejects community-moderation fixture activation`, () => {
    assert.throws(() =>
      communityModerationLocalEnvironment({ ...fixture, [key]: undefined }),
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
  ['COMMUNITY_MODERATION_LOCAL_E2E', 'true'],
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
      communityModerationLocalEnvironment({ ...fixture, [key]: value }),
    );
  });
test('a credential mismatch error does not expose either key', () => {
  const first = 'private-service-value';
  const second = 'private-fixture-value';
  assert.throws(
    () =>
      communityModerationLocalEnvironment({
        ...fixture,
        SUPABASE_SERVICE_ROLE_KEY: first,
        AUTH_TEST_SERVICE_KEY: second,
      }),
    (error) =>
      !String(error).includes(first) && !String(error).includes(second),
  );
});

test('default discovery excludes the isolated community-moderation suite', async () => {
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
  assert.doesNotMatch(
    listing,
    /community-moderation\/community-moderation\.spec/,
  );
});
test('dedicated community-moderation discovery fails closed without its local opt-in', async () => {
  const { execFileSync } = await import('node:child_process');
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          'node_modules/@playwright/test/cli.js',
          'test',
          '--config',
          'playwright.community-moderation.config.ts',
          '--list',
        ],
        {
          encoding: 'utf8',
          timeout: 30_000,
          env: {
            ...process.env,
            COMMUNITY_MODERATION_LOCAL_E2E: '',
            AUTH_LOCAL_E2E: '',
          },
          stdio: 'pipe',
        },
      ),
    (error) => /Run community-moderation tests only/.test(String(error.stderr)),
  );
});
test('opted-in discovery lists community-moderation tests without launching a browser, server or database', async () => {
  const { execFileSync } = await import('node:child_process');
  const listing = execFileSync(
    process.execPath,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--config',
      'playwright.community-moderation.config.ts',
      '--list',
      '--reporter=line',
    ],
    {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        ...fixture,
        ...COMMUNITY_MODERATION_CI_ENV,
        COMMUNITY_MODERATION_LOCAL_E2E: 'true',
      },
    },
  );
  assert.match(listing, /community-moderation\.spec\.ts/);
  assert.match(listing, /Total: 20 tests in 1 file/);
  assert.doesNotMatch(
    listing,
    /(?:auth-unconfigured|community-moderation-unconfigured|speech|media|replies)\.spec\.ts:/,
  );
});

test('document arrival verifies the actor-bound queue before forwarding instead of waiting for a worker-owned request', () => {
  const source = readFileSync(
    new URL(
      '../tests/e2e/community-moderation/community-moderation.spec.ts',
      import.meta.url,
    ),
    'utf8',
  );
  const observer = source
    .split('async function captureQueueArrival(')[1]
    ?.split('// Wait for the exact real RSC response')[0];
  assert.ok(observer);
  const checks = [
    "expect(request.method()).toBe('GET')",
    'expect(url.pathname + url.search).toBe(moderationQueuePath())',
    "expect(request.headers()['x-community-actor']).toBe(actor.id)",
    'const response = await route.fetch()',
    'moderationQueueSchema.parse(await success(response))',
    'expect(data.actor_id).toBe(actor.id)',
    'await route.fulfill({ response })',
    'accept()',
  ];
  let previous = -1;
  for (const check of checks) {
    const index = observer.indexOf(check);
    assert.ok(
      index > previous,
      `Queue verification missing or reordered: ${check}`,
    );
    previous = index;
  }
  assert.ok(
    source.includes(
      'const arrival = await captureQueueArrival(page, world.admin)',
    ),
  );
  assert.ok(
    source.includes('const response = await page.goto(routes.adminModeration)'),
  );
  assert.ok(source.includes('expect(response?.status()).toBe(200)'));
  assert.ok(source.includes('await arrival.result'));
  assert.ok(
    !source.includes('captureNavigation(page, routes.adminModeration)'),
  );
  assert.ok(source.includes('captureNavigation(page, routes.admin)'));
  assert.equal((source.match(/\{ timeout: 15_000 \}/g) ?? []).length, 2);
});
