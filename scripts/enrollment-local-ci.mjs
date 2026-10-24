import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { ENROLLMENT_CI } from '../src/config/enrollment-test-runtime.ts';

// Call after auth-local-ci environment in the disposable enrollment CI job.
// This writes only fixed fictional values, never generates or stores real keys.
assert.equal(process.argv[2], 'environment');
assert.equal(process.env.CI, 'true');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
assert.equal(process.env.NEXT_PUBLIC_APP_URL, ENROLLMENT_CI.appOrigin);
assert.equal(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  ENROLLMENT_CI.supabaseOrigin,
);
assert.equal(process.env.PAYMENTS_MODE, 'test');
assert.equal(process.env.TOSS_SECRET_KEY, ENROLLMENT_CI.tossSecretKey);
assert.equal(process.env.KAKAOPAY_SECRET_KEY, ENROLLMENT_CI.kakaoSecretKey);
assert.ok(
  !process.env.PAYMENTS_VAULT_KEY && !process.env.PAYMENTS_VAULT_KEY_VERSION,
);
assert.ok(!process.env.VERCEL && !process.env.VERCEL_ENV);
assert.ok(process.env.GITHUB_ENV);
appendFileSync(
  process.env.GITHUB_ENV,
  [
    'ENROLLMENT_LOCAL_E2E=true',
    `PAYMENTS_VAULT_KEY=${ENROLLMENT_CI.vaultKey}`,
    `PAYMENTS_VAULT_KEY_VERSION=${ENROLLMENT_CI.vaultVersion}`,
    '',
  ].join('\n'),
);
