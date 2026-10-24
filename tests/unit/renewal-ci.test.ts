// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  ENROLLMENT_CI,
  RENEWAL_CI,
  parseRenewalTestRuntime,
} from '@/config/enrollment-test-runtime';
import { parseServerEnv } from '@/config/env.server';
import { createPaymentVault } from '@/server/adapters/payment/vault';
import { parsePreparationEnvironment } from '@/server/adapters/payment/preparation';
import { createEnrollmentTransport } from '@/server/adapters/payment/ci-transport';

describe('renewal loopback transport boundary', () => {
  it('routes the real Kakao subscription endpoint only to the fixed local fixture', async () => {
    const response = Response.json({});
    const transport = vi.fn().mockResolvedValue(response);
    const run = createEnrollmentTransport({ mode: 'ci' }, transport)!;
    await expect(
      run('https://open-api.kakaopay.com/online/v1/payment/subscription', {
        method: 'POST',
        headers: {
          Authorization: `SECRET_KEY ${ENROLLMENT_CI.kakaoSecretKey}`,
        },
        body: '{}',
      }),
    ).resolves.toBe(response);
    expect(transport).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledWith(
      'http://127.0.0.1:3200/kakaopay/online/v1/payment/subscription',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        credentials: 'omit',
      }),
    );
    expect(
      new Headers(transport.mock.calls[0]![1].headers).has('Idempotency-Key'),
    ).toBe(false);
  });
  it.each([
    'https://open-api.kakaopay.com/online/v1/payment/manage/subscription/status',
    'https://open-api.kakaopay.com/online/v1/payment/manage/subscription/inactive',
    'https://open-api.kakaopay.com/online/v1/payment/cancel',
    'https://open-api.kakaopay.com/online/v1/payment/subscription?sid=secret',
    'http://127.0.0.1:3200/kakaopay/online/v1/payment/subscription',
    'https://open-api.kakaopay.com.evil.test/online/v1/payment/subscription',
  ])(
    'blocks recovery guesses, cancellation and noncanonical target %s',
    async (url) => {
      const transport = vi.fn();
      const run = createEnrollmentTransport({ mode: 'ci' }, transport)!;
      await expect(
        run(url, {
          method: 'POST',
          headers: {
            Authorization: `SECRET_KEY ${ENROLLMENT_CI.kakaoSecretKey}`,
          },
        }),
      ).rejects.toThrow('CI_PAYMENT_TRANSPORT_REJECTED');
      expect(transport).not.toHaveBeenCalled();
    },
  );
});

const complete = {
  ENROLLMENT_LOCAL_E2E: 'true',
  RENEWAL_LOCAL_E2E: 'true',
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
  RENEWAL_CRON_SECRET: RENEWAL_CI.cronSecret,
  PAYMENTS_RENEWALS_ENABLED: 'true',
};
describe('public renewal fixture token isolation', () => {
  it('accepts only the complete guarded local renewal test runtime', () => {
    expect(parseRenewalTestRuntime(complete)).toEqual({ mode: 'ci' });
    const parsed = parseServerEnv(complete);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsePreparationEnvironment(parsed.data).ok).toBe(true);
      expect(createPaymentVault(parsed.data)).not.toBeNull();
    }
  });
  it.each(Object.keys(complete))(
    'rejects changed fixture prerequisite %s',
    (key) => {
      expect(parseServerEnv({ ...complete, [key]: 'wrong' }).ok).toBe(false);
      expect(parseRenewalTestRuntime({ ...complete, [key]: 'wrong' })).toEqual({
        mode: 'invalid',
      });
    },
  );
  it.each(['VERCEL', 'VERCEL_ENV', 'NETLIFY', 'AWS_LAMBDA_FUNCTION_NAME'])(
    'rejects deployment indicator %s',
    (key) => {
      expect(parseServerEnv({ ...complete, [key]: 'present' }).ok).toBe(false);
      expect(
        parseRenewalTestRuntime({ ...complete, [key]: 'present' }),
      ).toEqual({ mode: 'invalid' });
    },
  );
  it.each([undefined, '', 'false'])(
    'does not promote a public token to a real credential when test flag is %s',
    (RENEWAL_LOCAL_E2E) => {
      expect(
        parseServerEnv({
          NODE_ENV: 'production',
          RENEWAL_LOCAL_E2E,
          PAYMENTS_RENEWALS_ENABLED: 'true',
          RENEWAL_CRON_SECRET: RENEWAL_CI.cronSecret,
        }).ok,
      ).toBe(false);
      expect(
        parseRenewalTestRuntime({
          NODE_ENV: 'production',
          RENEWAL_LOCAL_E2E,
          PAYMENTS_RENEWALS_ENABLED: 'true',
          RENEWAL_CRON_SECRET: RENEWAL_CI.cronSecret,
          // These are deliberately nonfixture placeholders, not real credentials.
          TOSS_SECRET_KEY: 'live_sk_nonfixture_placeholder',
          KAKAOPAY_SECRET_KEY: 'nonfixture-placeholder',
        }),
      ).toEqual({ mode: 'invalid' });
    },
  );
  it.each(['true', 'wrong', null, false, 1])(
    'partial or malformed active test flag %s never falls back to real mode',
    (RENEWAL_LOCAL_E2E) => {
      expect(
        parseRenewalTestRuntime({ NODE_ENV: 'production', RENEWAL_LOCAL_E2E }),
      ).toEqual({ mode: 'invalid' });
    },
  );
  it.each([undefined, '', 'false'])(
    'allows ordinary configuration without active test flag %s',
    (RENEWAL_LOCAL_E2E) => {
      expect(
        parseServerEnv({
          NODE_ENV: 'production',
          RENEWAL_LOCAL_E2E,
          PAYMENTS_RENEWALS_ENABLED: 'true',
          RENEWAL_CRON_SECRET: RENEWAL_CI.cronSecret,
        }).ok,
      ).toBe(false);
      expect(
        parseRenewalTestRuntime({
          NODE_ENV: 'production',
          RENEWAL_LOCAL_E2E,
          RENEWAL_CRON_SECRET: 'nonfixture-private-token-placeholder',
        }),
      ).toEqual({ mode: 'real' });
    },
  );
});
