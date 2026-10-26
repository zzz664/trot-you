import assert from 'node:assert/strict';
// Public non-secret constants for the disposable local CI job only.
export const ANALYTICS_FUNNEL_CI_ENV = Object.freeze({
  SCHEDULE_NOTICES_ENABLED: 'false',
  SCHEDULE_NOTICES_CRON_SECRET: '',
  MESSAGE_DISPATCH_ENABLED: 'false',
  MESSAGE_DISPATCH_CRON_SECRET: '',
  BILLING_NOTICES_ENABLED: 'false',
  BILLING_NOTICES_CRON_SECRET: '',
  PAYMENTS_MODE: 'disabled',
  TOSS_BILLING_ENABLED: 'false',
  KAKAOPAY_SUBSCRIPTION_ENABLED: 'false',
  PAYMENTS_RENEWALS_ENABLED: 'false',
  PAYMENTS_REFUNDS_ENABLED: 'false',
  PAYMENTS_RECONCILIATION_ENABLED: 'false',
  WEBPUSH_ENABLED: 'false',
  WEBPUSH_WORKER_ENABLED: 'false',
  NEXT_PUBLIC_TOSS_CLIENT_KEY: '',
  TOSS_SECRET_KEY: '',
  TOSS_BILLING_MID: '',
  KAKAOPAY_SECRET_KEY: '',
  KAKAOPAY_RECURRING_CID: '',
  KAKAOPAY_CID_SECRET: '',
});

// Pure local-CI guard. No network, database, files, provider or app imports.
export function analyticsFunnelLocalEnvironment(environment) {
  assert.equal(environment.CI, 'true', 'Analytics-funnel fixtures require CI.');
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
    !environment.ANALYTICS_FUNNEL_LOCAL_E2E,
    'Do not inherit an analytics-funnel fixture mode.',
  );
  for (const key of [
    'SCHEDULE_NOTICES_ENABLED',
    'SCHEDULE_NOTICES_CRON_SECRET',
    'MESSAGE_DISPATCH_ENABLED',
    'MESSAGE_DISPATCH_CRON_SECRET',
    'BILLING_NOTICES_ENABLED',
    'BILLING_NOTICES_CRON_SECRET',
    'VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY',
    'VAPID_SUBJECT',
    'WEBPUSH_ENABLED',
    'WEBPUSH_WORKER_ENABLED',
    'WEBPUSH_CRON_SECRET',
    'PAYMENTS_RENEWALS_ENABLED',
    'PAYMENTS_REFUNDS_ENABLED',
    'PAYMENTS_RECONCILIATION_ENABLED',
    'PAYMENTS_VAULT_KEY',
    'PAYMENTS_VAULT_KEY_VERSION',
    'RENEWAL_CRON_SECRET',
    'REFUND_CRON_SECRET',
    'RECONCILIATION_CRON_SECRET',
  ])
    assert.ok(
      !environment[key],
      'Do not inherit a delivery or payment configuration.',
    );
  // auth-local-ci emits these exact public, unusable test placeholders. Accept
  // only that known input and clear it before build; never accept live secrets.
  const authOnly = {
    PAYMENTS_MODE: 'test',
    TOSS_BILLING_ENABLED: 'true',
    KAKAOPAY_SUBSCRIPTION_ENABLED: 'true',
    NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_ck_checkout_ci_fixture',
    TOSS_SECRET_KEY: 'test_sk_checkout_ci_fixture',
    TOSS_BILLING_MID: 'checkout_ci_fictional_mid',
    KAKAOPAY_SECRET_KEY: 'checkout_ci_not_a_real_key',
    KAKAOPAY_RECURRING_CID: 'TCSUBSCRIP',
    KAKAOPAY_CID_SECRET: '',
  };
  for (const [key, value] of Object.entries(authOnly))
    assert.ok(
      !environment[key] || environment[key] === value,
      'Only the exact preceding local Auth placeholders are allowed.',
    );
  return (
    'ANALYTICS_FUNNEL_LOCAL_E2E=true\n' +
    Object.entries(ANALYTICS_FUNNEL_CI_ENV)
      .map(([key, value]) => `${key}=${value}\n`)
      .join('')
  );
}
