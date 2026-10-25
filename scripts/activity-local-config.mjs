import assert from 'node:assert/strict';

// Pure local-CI guard. No network, database, files, provider or app imports.
export function activityLocalEnvironment(environment) {
  assert.equal(environment.CI, 'true', 'Activity fixtures require CI.');
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
    !environment.ACTIVITY_LOCAL_E2E,
    'Do not inherit an activity fixture mode.',
  );
  return 'ACTIVITY_LOCAL_E2E=true\n';
}
