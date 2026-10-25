import assert from 'node:assert/strict';

// Pure local-CI guard. No network, database, files, provider or app imports.
export function dispatchLocalEnvironment(environment, cronSecret) {
  assert.equal(environment.CI, 'true', 'Dispatch fixtures require CI.');
  assert.equal(environment.GITHUB_ACTIONS, 'true', 'Use the isolated CI job.');
  assert.equal(environment.AUTH_LOCAL_E2E, 'true', 'Local Auth must be ready.');
  assert.equal(environment.NEXT_PUBLIC_APP_URL, 'http://127.0.0.1:3100');
  assert.equal(environment.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:54321');
  assert.ok(
    environment.AUTH_TEST_SERVICE_KEY,
    'Local fixture key is required.',
  );
  // Use a boolean assertion, not assert.equal(secret,secret): an accidental
  // mismatch must never print either credential in a test/setup failure.
  assert.ok(
    environment.SUPABASE_SERVICE_ROLE_KEY === environment.AUTH_TEST_SERVICE_KEY,
    'Application and fixture must target the same disposable local stack.',
  );
  assert.ok(!environment.DOCKER_HOST && !environment.DOCKER_CONTEXT);
  assert.ok(
    !environment.SUPABASE_ACCESS_TOKEN && !environment.SUPABASE_DB_PASSWORD,
  );
  assert.ok(
    !environment.DISPATCH_LOCAL_E2E,
    'Do not inherit a dispatch fixture mode.',
  );
  assert.ok(!environment.MESSAGE_DISPATCH_ENABLED);
  assert.ok(!environment.MESSAGE_DISPATCH_CRON_SECRET);
  assert.ok(
    typeof cronSecret === 'string' &&
      /^[A-Za-z0-9_-]{32,256}$/.test(cronSecret),
    'Fresh bounded local worker secret is required.',
  );
  assert.ok(
    ![
      environment.CRON_SECRET,
      environment.RENEWAL_CRON_SECRET,
      environment.RECONCILIATION_CRON_SECRET,
    ].includes(cronSecret),
    'Use a dedicated local dispatch credential.',
  );
  return [
    'DISPATCH_LOCAL_E2E=true',
    'MESSAGE_DISPATCH_ENABLED=true',
    `MESSAGE_DISPATCH_CRON_SECRET=${cronSecret}`,
    '',
  ].join('\n');
}
