// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseServerEnv } from '@/config/env.server';
import { parsePreparationEnvironment } from '@/server/adapters/payment/preparation';
import { ENROLLMENT_CI, RENEWAL_CI } from '@/config/enrollment-test-runtime';
import {
  RECONCILIATION_CI,
  parseReconciliationTestRuntime,
} from '@/config/reconciliation-test-runtime';

const complete = {
  RECONCILIATION_LOCAL_E2E: 'true',
  PAYMENTS_RECONCILIATION_ENABLED: 'true',
  RECONCILIATION_CRON_SECRET: RECONCILIATION_CI.cronSecret,
  CANCELLATION_LOCAL_E2E: 'true',
  PAYMENTS_REFUNDS_ENABLED: 'true',
  RENEWAL_LOCAL_E2E: 'true',
  PAYMENTS_RENEWALS_ENABLED: 'true',
  RENEWAL_CRON_SECRET: RENEWAL_CI.cronSecret,
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

describe('reconciliation fixture credential isolation', () => {
  it('accepts only the complete development GitHub Actions local stack', () => {
    expect(parseReconciliationTestRuntime(complete)).toEqual({ mode: 'ci' });
    const parsed = parseServerEnv(complete);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('fixture');
    const provider = parsePreparationEnvironment(parsed.data);
    expect(provider.ok).toBe(true);
    if (!provider.ok) throw new Error('fixture');
    expect(provider.data.RECONCILIATION_CRON_SECRET).toBeUndefined();
  });
  it.each(Object.keys(complete))('rejects altered prerequisite %s', (key) => {
    expect(
      parseReconciliationTestRuntime({ ...complete, [key]: 'wrong' }),
    ).toEqual({ mode: 'invalid' });
    expect(parseServerEnv({ ...complete, [key]: 'wrong' }).ok).toBe(false);
  });
  it.each(['VERCEL', 'VERCEL_ENV', 'NETLIFY', 'AWS_LAMBDA_FUNCTION_NAME'])(
    'rejects deployment indicator %s',
    (key) => {
      expect(
        parseReconciliationTestRuntime({ ...complete, [key]: 'present' }),
      ).toEqual({ mode: 'invalid' });
    },
  );
  it.each([undefined, '', 'false'])(
    'never accepts public fixture secret with inactive flag %s',
    (flag) => {
      expect(
        parseReconciliationTestRuntime({
          ...complete,
          RECONCILIATION_LOCAL_E2E: flag,
        }),
      ).toEqual({ mode: 'invalid' });
      expect(
        parseReconciliationTestRuntime({
          NODE_ENV: 'production',
          RECONCILIATION_LOCAL_E2E: flag,
          RECONCILIATION_CRON_SECRET: RECONCILIATION_CI.cronSecret,
        }),
      ).toEqual({ mode: 'invalid' });
      expect(
        parseReconciliationTestRuntime({
          NODE_ENV: 'production',
          RECONCILIATION_LOCAL_E2E: flag,
        }),
      ).toEqual({ mode: 'real' });
    },
  );
  it.each(['true', 'wrong', null, false, 1])(
    'rejects a partial active flag %s',
    (flag) => {
      expect(
        parseReconciliationTestRuntime({
          RECONCILIATION_LOCAL_E2E: flag,
          NODE_ENV: 'production',
        }),
      ).toEqual({ mode: 'invalid' });
    },
  );
});
