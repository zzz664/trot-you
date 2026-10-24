import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dispatchLocalEnvironment } from './dispatch-local-config.mjs';

const secret = 'fictional-dispatch-worker-key-for-isolated-CI';
const fixture = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  AUTH_LOCAL_E2E: 'true',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  AUTH_TEST_SERVICE_KEY: 'fictional-local-fixture-key',
  SUPABASE_SERVICE_ROLE_KEY: 'fictional-local-fixture-key',
};
test('local dispatch opt-in writes bounded worker settings, never Supabase credentials', () => {
  assert.ok(
    !dispatchLocalEnvironment(fixture, secret).includes(
      fixture.AUTH_TEST_SERVICE_KEY,
    ),
  );
  assert.equal(
    dispatchLocalEnvironment(fixture, secret),
    `DISPATCH_LOCAL_E2E=true\nMESSAGE_DISPATCH_ENABLED=true\nMESSAGE_DISPATCH_CRON_SECRET=${secret}\n`,
  );
});
for (const key of [
  'CI',
  'GITHUB_ACTIONS',
  'AUTH_LOCAL_E2E',
  'AUTH_TEST_SERVICE_KEY',
])
  test(`missing ${key} rejects dispatch fixture activation`, () => {
    assert.throws(() =>
      dispatchLocalEnvironment({ ...fixture, [key]: undefined }, secret),
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
  ['DISPATCH_LOCAL_E2E', 'true'],
  ['MESSAGE_DISPATCH_ENABLED', 'true'],
  ['MESSAGE_DISPATCH_CRON_SECRET', 'inherited-private-value'],
])
  test(`${key} override rejects before any file write or network call`, () => {
    assert.throws(() =>
      dispatchLocalEnvironment({ ...fixture, [key]: value }, secret),
    );
  });
test('a credential mismatch error does not expose either key', () => {
  const first = 'private-service-value';
  const second = 'private-fixture-value';
  assert.throws(
    () =>
      dispatchLocalEnvironment(
        {
          ...fixture,
          SUPABASE_SERVICE_ROLE_KEY: first,
          AUTH_TEST_SERVICE_KEY: second,
        },
        secret,
      ),
    (error) =>
      !String(error).includes(first) && !String(error).includes(second),
  );
});

test('default Playwright discovery cannot silently include the isolated dispatch suite', async () => {
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
  assert.doesNotMatch(listing, /dispatch\/message-dispatch\.spec/);
});
test('dedicated dispatch discovery fails closed without its exact local opt-in', async () => {
  const { execFileSync } = await import('node:child_process');
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          'node_modules/@playwright/test/cli.js',
          'test',
          '--config',
          'playwright.dispatch.config.ts',
          '--list',
        ],
        {
          encoding: 'utf8',
          timeout: 30_000,
          env: { ...process.env, DISPATCH_LOCAL_E2E: '', AUTH_LOCAL_E2E: '' },
          stdio: 'pipe',
        },
      ),
    (error) => /Run dispatch tests only/.test(String(error.stderr)),
  );
});

test('opted-in dispatch discovery lists its own tests without launching a server or browser', async () => {
  const { execFileSync } = await import('node:child_process');
  // --list is discovery only. These fictional values must never activate a
  // process that runs tests, starts Supabase, launches a browser or makes I/O.
  const listing = execFileSync(
    process.execPath,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--config',
      'playwright.dispatch.config.ts',
      '--list',
      '--reporter=line',
    ],
    {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        ...fixture,
        DISPATCH_LOCAL_E2E: 'true',
        MESSAGE_DISPATCH_ENABLED: 'true',
        MESSAGE_DISPATCH_CRON_SECRET: secret,
      },
    },
  );
  assert.match(listing, /message-dispatch\.spec\.ts/);
  assert.match(listing, /Total: [1-9][0-9]* tests in 1 file/);
  assert.doesNotMatch(
    listing,
    /(?:auth-unconfigured|dispatch-unconfigured|speech|media|replies)\.spec\.ts:/,
  );
});

for (const value of [
  undefined,
  '',
  'short',
  'has spaces in the local-secret',
  'x'.repeat(257),
])
  test(`rejects invalid local worker credential shape (${typeof value})`, () => {
    assert.throws(() => dispatchLocalEnvironment(fixture, value));
  });
for (const key of [
  'CRON_SECRET',
  'RENEWAL_CRON_SECRET',
  'RECONCILIATION_CRON_SECRET',
])
  test(`does not reuse ${key}`, () => {
    assert.throws(() =>
      dispatchLocalEnvironment({ ...fixture, [key]: secret }, secret),
    );
  });
