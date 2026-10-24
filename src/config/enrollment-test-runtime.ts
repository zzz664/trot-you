// These values are deliberately public, fictional test fixtures. They are not
// merchant credentials and must never be used with an external payment host.
export const ENROLLMENT_CI = {
  appOrigin: 'http://127.0.0.1:3100',
  supabaseOrigin: 'http://127.0.0.1:54321',
  providerOrigin: 'http://127.0.0.1:3200',
  tossClientKey: 'test_ck_checkout_ci_fixture',
  tossSecretKey: 'test_sk_checkout_ci_fixture',
  tossMid: 'checkout_ci_fictional_mid',
  kakaoSecretKey: 'checkout_ci_not_a_real_key',
  kakaoCid: 'TCSUBSCRIP',
  vaultKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  vaultVersion: 'ci-fixture-only',
} as const;

export type EnrollmentTestRuntime = {
  mode: 'real' | 'ci' | 'invalid';
};

// Parsed independently of deployment configuration: test flags are not a
// production integration option, and a partially set flag must fail closed.
export function parseEnrollmentTestRuntime(
  input: Record<string, unknown>,
): EnrollmentTestRuntime {
  if (
    input.ENROLLMENT_LOCAL_E2E === undefined ||
    input.ENROLLMENT_LOCAL_E2E === '' ||
    input.ENROLLMENT_LOCAL_E2E === 'false'
  )
    // A missing flag must not accidentally send the fictional CI credentials
    // to a real provider endpoint. The preparation-only auth job has no vault
    // and never reaches this transport, so it remains a nonpayment regression.
    return {
      mode:
        input.TOSS_SECRET_KEY === ENROLLMENT_CI.tossSecretKey ||
        input.KAKAOPAY_SECRET_KEY === ENROLLMENT_CI.kakaoSecretKey ||
        input.PAYMENTS_VAULT_KEY === ENROLLMENT_CI.vaultKey
          ? 'invalid'
          : 'real',
    };
  const expected = {
    ENROLLMENT_LOCAL_E2E: 'true',
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    AUTH_LOCAL_E2E: 'true',
    NODE_ENV: 'development',
    NEXT_PUBLIC_APP_URL: ENROLLMENT_CI.appOrigin,
    NEXT_PUBLIC_SUPABASE_URL: ENROLLMENT_CI.supabaseOrigin,
    PAYMENTS_MODE: 'test',
    TOSS_BILLING_ENABLED: 'true',
    KAKAOPAY_SUBSCRIPTION_ENABLED: 'true',
    NEXT_PUBLIC_TOSS_CLIENT_KEY: ENROLLMENT_CI.tossClientKey,
    TOSS_SECRET_KEY: ENROLLMENT_CI.tossSecretKey,
    TOSS_BILLING_MID: ENROLLMENT_CI.tossMid,
    KAKAOPAY_SECRET_KEY: ENROLLMENT_CI.kakaoSecretKey,
    KAKAOPAY_RECURRING_CID: ENROLLMENT_CI.kakaoCid,
    PAYMENTS_VAULT_KEY: ENROLLMENT_CI.vaultKey,
    PAYMENTS_VAULT_KEY_VERSION: ENROLLMENT_CI.vaultVersion,
  };
  return Object.entries(expected).every(
    ([key, value]) => input[key] === value,
  ) &&
    !input.KAKAOPAY_CID_SECRET &&
    !input.VERCEL &&
    !input.VERCEL_ENV &&
    !input.NETLIFY &&
    !input.AWS_LAMBDA_FUNCTION_NAME
    ? { mode: 'ci' }
    : { mode: 'invalid' };
}

export const ENROLLMENT_CI_TOSS_PATHS = [
  /^\/v1\/billing\/authorizations\/issue$/,
  /^\/v1\/billing\/[A-Za-z0-9_-]+$/,
  /^\/v1\/payments\/orders\/[A-Za-z0-9_-]+$/,
] as const;
export const ENROLLMENT_CI_KAKAO_PATHS = [
  /^\/online\/v1\/payment\/(ready|approve|order|subscription)$/,
] as const;

// Also public fixtures. Never a deployed Cron credential or scheduling setup.
export const RENEWAL_CI = {
  cronSecret: 'renewal_ci_only_not_a_real_cron_secret_000000000000000000000000',
} as const;

// A public test token must never authenticate a real renewal worker, even when
// all merchant credentials happen to be valid. Any active/partial test flag is
// also fail-closed rather than falling back to real provider transport.
export function parseRenewalTestRuntime(
  input: Record<string, unknown>,
): EnrollmentTestRuntime {
  const inactive =
    input.RENEWAL_LOCAL_E2E === undefined ||
    input.RENEWAL_LOCAL_E2E === '' ||
    input.RENEWAL_LOCAL_E2E === 'false';
  if (inactive && input.RENEWAL_CRON_SECRET !== RENEWAL_CI.cronSecret)
    return { mode: 'real' };
  return input.RENEWAL_LOCAL_E2E === 'true' &&
    input.PAYMENTS_RENEWALS_ENABLED === 'true' &&
    input.RENEWAL_CRON_SECRET === RENEWAL_CI.cronSecret &&
    parseEnrollmentTestRuntime(input).mode === 'ci'
    ? { mode: 'ci' }
    : { mode: 'invalid' };
}
