import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeLocalEnvironment } from './compose-local-config.mjs';

const fixture = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  AUTH_LOCAL_E2E: 'true',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  AUTH_TEST_SERVICE_KEY: 'fictional-local-fixture-key',
  SUPABASE_SERVICE_ROLE_KEY: 'fictional-local-fixture-key',
};
test('local compose opt-in writes only its bounded flag, never fixture credentials', () => {
  assert.equal(composeLocalEnvironment(fixture), 'COMPOSE_LOCAL_E2E=true\n');
});
for (const key of [
  'CI',
  'GITHUB_ACTIONS',
  'AUTH_LOCAL_E2E',
  'AUTH_TEST_SERVICE_KEY',
])
  test(`missing ${key} rejects compose fixture activation`, () => {
    assert.throws(() =>
      composeLocalEnvironment({ ...fixture, [key]: undefined }),
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
  ['COMPOSE_LOCAL_E2E', 'true'],
])
  test(`${key} override rejects before any file write or network call`, () => {
    assert.throws(() => composeLocalEnvironment({ ...fixture, [key]: value }));
  });
test('a credential mismatch error does not expose either key', () => {
  const first = 'private-service-value';
  const second = 'private-fixture-value';
  assert.throws(
    () =>
      composeLocalEnvironment({
        ...fixture,
        SUPABASE_SERVICE_ROLE_KEY: first,
        AUTH_TEST_SERVICE_KEY: second,
      }),
    (error) =>
      !String(error).includes(first) && !String(error).includes(second),
  );
});

test('default Playwright discovery cannot silently include the isolated compose suite', async () => {
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
  assert.doesNotMatch(listing, /compose\/artist-compose\.spec/);
});
test('dedicated compose discovery fails closed without its exact local opt-in', async () => {
  const { execFileSync } = await import('node:child_process');
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          'node_modules/@playwright/test/cli.js',
          'test',
          '--config',
          'playwright.compose.config.ts',
          '--list',
        ],
        {
          encoding: 'utf8',
          timeout: 30_000,
          env: { ...process.env, COMPOSE_LOCAL_E2E: '', AUTH_LOCAL_E2E: '' },
          stdio: 'pipe',
        },
      ),
    (error) => /Run compose tests only/.test(String(error.stderr)),
  );
});

test('opted-in compose discovery lists its own tests without launching a server or browser', async () => {
  const { execFileSync } = await import('node:child_process');
  // --list is discovery only. These fictional values must never activate a
  // process that runs tests, starts Supabase, launches a browser or makes I/O.
  const listing = execFileSync(
    process.execPath,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--config',
      'playwright.compose.config.ts',
      '--list',
      '--reporter=line',
    ],
    {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, ...fixture, COMPOSE_LOCAL_E2E: 'true' },
    },
  );
  assert.match(listing, /artist-compose\.spec\.ts/);
  assert.match(listing, /Total: [1-9][0-9]* tests in 1 file/);
  assert.doesNotMatch(
    listing,
    /(?:auth-unconfigured|speech|media|replies)\.spec\.ts:/,
  );
});
