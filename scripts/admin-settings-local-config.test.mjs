import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ADMIN_SETTINGS_CI_ENV,
  adminSettingsLocalEnvironment,
} from './admin-settings-local-config.mjs';

const fixture = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  AUTH_LOCAL_E2E: 'true',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  AUTH_TEST_SERVICE_KEY: 'fictional-local-fixture-key',
  SUPABASE_SERVICE_ROLE_KEY: 'fictional-local-fixture-key',
};
test('local admin-settings opt-in writes only disabled delivery and payment settings, never fixture credentials', () => {
  assert.equal(
    adminSettingsLocalEnvironment(fixture),
    'ADMIN_SETTINGS_LOCAL_E2E=true\n' +
      Object.entries(ADMIN_SETTINGS_CI_ENV)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
  );
});
test('exact Auth-only placeholders are cleared before the admin browser build', () => {
  const output = adminSettingsLocalEnvironment({
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
  test(`missing ${key} rejects admin-settings fixture activation`, () => {
    assert.throws(() =>
      adminSettingsLocalEnvironment({ ...fixture, [key]: undefined }),
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
  ['ADMIN_SETTINGS_LOCAL_E2E', 'true'],
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
      adminSettingsLocalEnvironment({ ...fixture, [key]: value }),
    );
  });
test('a credential mismatch error does not expose either key', () => {
  const first = 'private-service-value';
  const second = 'private-fixture-value';
  assert.throws(
    () =>
      adminSettingsLocalEnvironment({
        ...fixture,
        SUPABASE_SERVICE_ROLE_KEY: first,
        AUTH_TEST_SERVICE_KEY: second,
      }),
    (error) =>
      !String(error).includes(first) && !String(error).includes(second),
  );
});

test('default discovery excludes the isolated admin-settings suite', async () => {
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
  assert.doesNotMatch(listing, /admin-settings\/admin-settings\.spec/);
});
test('dedicated admin-settings discovery fails closed without its local opt-in', async () => {
  const { execFileSync } = await import('node:child_process');
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          'node_modules/@playwright/test/cli.js',
          'test',
          '--config',
          'playwright.admin-settings.config.ts',
          '--list',
        ],
        {
          encoding: 'utf8',
          timeout: 30_000,
          env: {
            ...process.env,
            ADMIN_SETTINGS_LOCAL_E2E: '',
            AUTH_LOCAL_E2E: '',
          },
          stdio: 'pipe',
        },
      ),
    (error) => /Run admin-settings tests only/.test(String(error.stderr)),
  );
});
test('opted-in discovery lists admin-settings tests without launching a browser, server or database', async () => {
  const { execFileSync } = await import('node:child_process');
  const listing = execFileSync(
    process.execPath,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--config',
      'playwright.admin-settings.config.ts',
      '--list',
      '--reporter=line',
    ],
    {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        ...fixture,
        ...ADMIN_SETTINGS_CI_ENV,
        ADMIN_SETTINGS_LOCAL_E2E: 'true',
      },
    },
  );
  assert.match(listing, /admin-settings\.spec\.ts/);
  assert.match(listing, /Total: [1-9][0-9]* tests in 1 file/);
  assert.doesNotMatch(
    listing,
    /(?:auth-unconfigured|admin-settings-unconfigured|speech|media|replies)\.spec\.ts:/,
  );
});
