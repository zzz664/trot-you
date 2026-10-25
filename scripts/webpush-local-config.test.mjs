import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webpushLocalEnvironment } from './webpush-local-config.mjs';
import { WEBPUSH_CI_ENV } from './webpush-local-fixtures.mjs';

const fixture = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  AUTH_LOCAL_E2E: 'true',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  AUTH_TEST_SERVICE_KEY: 'fictional-local-fixture-key',
  SUPABASE_SERVICE_ROLE_KEY: 'fictional-local-fixture-key',
};
test('local webpush opt-in writes only explicit public synthetic configuration, never local service credentials', () => {
  assert.equal(
    webpushLocalEnvironment(fixture),
    Object.entries(WEBPUSH_CI_ENV)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  );
  assert.equal(WEBPUSH_CI_ENV.WEBPUSH_WORKER_ENABLED, 'false');
  assert.ok(!('WEBPUSH_CRON_SECRET' in WEBPUSH_CI_ENV));
});
for (const key of [
  'CI',
  'GITHUB_ACTIONS',
  'AUTH_LOCAL_E2E',
  'AUTH_TEST_SERVICE_KEY',
])
  test(`missing ${key} rejects webpush fixture activation`, () => {
    assert.throws(() =>
      webpushLocalEnvironment({ ...fixture, [key]: undefined }),
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
  ['WEBPUSH_LOCAL_E2E', 'true'],
  ['WEBPUSH_ENABLED', 'true'],
  ['WEBPUSH_WORKER_ENABLED', 'true'],
  ['WEBPUSH_CRON_SECRET', 'inherited-secret'],
  ['VAPID_PUBLIC_KEY', 'inherited-key'],
  ['VAPID_PRIVATE_KEY', 'inherited-secret'],
  ['VAPID_SUBJECT', 'mailto:real@example.com'],
])
  test(`${key} override rejects before any file write or network call`, () => {
    assert.throws(() => webpushLocalEnvironment({ ...fixture, [key]: value }));
  });
test('a credential mismatch error does not expose either key', () => {
  const first = 'private-service-value';
  const second = 'private-fixture-value';
  assert.throws(
    () =>
      webpushLocalEnvironment({
        ...fixture,
        SUPABASE_SERVICE_ROLE_KEY: first,
        AUTH_TEST_SERVICE_KEY: second,
      }),
    (error) =>
      !String(error).includes(first) && !String(error).includes(second),
  );
});

test('default discovery excludes the isolated webpush suite', async () => {
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
  assert.doesNotMatch(listing, /webpush\/webpush\.spec/);
});
test('dedicated webpush discovery fails closed without its local opt-in', async () => {
  const { execFileSync } = await import('node:child_process');
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          'node_modules/@playwright/test/cli.js',
          'test',
          '--config',
          'playwright.webpush.config.ts',
          '--list',
        ],
        {
          encoding: 'utf8',
          timeout: 30_000,
          env: { ...process.env, WEBPUSH_LOCAL_E2E: '', AUTH_LOCAL_E2E: '' },
          stdio: 'pipe',
        },
      ),
    (error) => /Run webpush tests only/.test(String(error.stderr)),
  );
});
test('opted-in discovery lists webpush tests without launching a browser, server or database', async () => {
  const { execFileSync } = await import('node:child_process');
  const listing = execFileSync(
    process.execPath,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--config',
      'playwright.webpush.config.ts',
      '--list',
      '--reporter=line',
    ],
    {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        ...fixture,
        ...WEBPUSH_CI_ENV,
        WEBPUSH_CRON_SECRET: '',
      },
    },
  );
  assert.match(listing, /webpush\.spec\.ts/);
  assert.match(listing, /Total: [1-9][0-9]* tests in 1 file/);
  assert.doesNotMatch(
    listing,
    /(?:auth-unconfigured|webpush-unconfigured|speech|media|replies)\.spec\.ts:/,
  );
});
