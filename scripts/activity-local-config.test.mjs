import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activityLocalEnvironment } from './activity-local-config.mjs';

const fixture = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  AUTH_LOCAL_E2E: 'true',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  AUTH_TEST_SERVICE_KEY: 'fictional-local-fixture-key',
  SUPABASE_SERVICE_ROLE_KEY: 'fictional-local-fixture-key',
};
test('local activity opt-in writes only its bounded flag, never fixture credentials', () => {
  assert.equal(activityLocalEnvironment(fixture), 'ACTIVITY_LOCAL_E2E=true\n');
});
for (const key of [
  'CI',
  'GITHUB_ACTIONS',
  'AUTH_LOCAL_E2E',
  'AUTH_TEST_SERVICE_KEY',
])
  test(`missing ${key} rejects activity fixture activation`, () => {
    assert.throws(() =>
      activityLocalEnvironment({ ...fixture, [key]: undefined }),
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
  ['ACTIVITY_LOCAL_E2E', 'true'],
])
  test(`${key} override rejects before any file write or network call`, () => {
    assert.throws(() => activityLocalEnvironment({ ...fixture, [key]: value }));
  });
test('a credential mismatch error does not expose either key', () => {
  const first = 'private-service-value';
  const second = 'private-fixture-value';
  assert.throws(
    () =>
      activityLocalEnvironment({
        ...fixture,
        SUPABASE_SERVICE_ROLE_KEY: first,
        AUTH_TEST_SERVICE_KEY: second,
      }),
    (error) =>
      !String(error).includes(first) && !String(error).includes(second),
  );
});

test('default discovery excludes the isolated activity suite', async () => {
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
  assert.doesNotMatch(listing, /activity\/artist-reply-activity\.spec/);
});
test('dedicated activity discovery fails closed without its local opt-in', async () => {
  const { execFileSync } = await import('node:child_process');
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          'node_modules/@playwright/test/cli.js',
          'test',
          '--config',
          'playwright.activity.config.ts',
          '--list',
        ],
        {
          encoding: 'utf8',
          timeout: 30_000,
          env: { ...process.env, ACTIVITY_LOCAL_E2E: '', AUTH_LOCAL_E2E: '' },
          stdio: 'pipe',
        },
      ),
    (error) => /Run activity tests only/.test(String(error.stderr)),
  );
});
test('opted-in discovery lists activity tests without launching a browser, server or database', async () => {
  const { execFileSync } = await import('node:child_process');
  const listing = execFileSync(
    process.execPath,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--config',
      'playwright.activity.config.ts',
      '--list',
      '--reporter=line',
    ],
    {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, ...fixture, ACTIVITY_LOCAL_E2E: 'true' },
    },
  );
  assert.match(listing, /artist-reply-activity\.spec\.ts/);
  assert.match(listing, /Total: [1-9][0-9]* tests in 1 file/);
  assert.doesNotMatch(
    listing,
    /(?:auth-unconfigured|activity-unconfigured|speech|media|replies)\.spec\.ts:/,
  );
});
