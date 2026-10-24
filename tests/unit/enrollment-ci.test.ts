// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  ENROLLMENT_CI,
  parseEnrollmentTestRuntime,
} from '@/config/enrollment-test-runtime';
import { createEnrollmentTransport } from '@/server/adapters/payment/ci-transport';

const ci = {
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

describe('development-only controlled enrollment transport', () => {
  it('leaves the real production adapter transport intact by default', () => {
    const transport = vi.fn();
    expect(parseEnrollmentTestRuntime({ NODE_ENV: 'production' })).toEqual({
      mode: 'real',
    });
    expect(createEnrollmentTransport({ mode: 'real' }, transport)).toBe(
      transport,
    );
    expect(transport).not.toHaveBeenCalled();
  });
  it('accepts only the complete fictional local CI runtime', () => {
    expect(parseEnrollmentTestRuntime(ci)).toEqual({ mode: 'ci' });
  });
  it.each([undefined, '', 'false'])(
    'never sends fixture credentials to real APIs when the explicit flag is %s',
    (ENROLLMENT_LOCAL_E2E) => {
      const runtime = parseEnrollmentTestRuntime({
        ...ci,
        ENROLLMENT_LOCAL_E2E,
      });
      expect(runtime).toEqual({ mode: 'invalid' });
      expect(createEnrollmentTransport(runtime, vi.fn())).toBeNull();
    },
  );
  it.each(Object.keys(ci))('rejects changed CI guard %s', (key) => {
    const result = parseEnrollmentTestRuntime({ ...ci, [key]: 'wrong' });
    expect(result).toEqual({ mode: 'invalid' });
    expect(createEnrollmentTransport(result, vi.fn())).toBeNull();
  });
  it.each([
    'VERCEL',
    'VERCEL_ENV',
    'NETLIFY',
    'AWS_LAMBDA_FUNCTION_NAME',
    'KAKAOPAY_CID_SECRET',
  ])('rejects deployment/credential indicator %s', (key) =>
    expect(parseEnrollmentTestRuntime({ ...ci, [key]: 'present' })).toEqual({
      mode: 'invalid',
    }),
  );
  it.each(['production', 'test', undefined])(
    'rejects mock transport NODE_ENV=%s',
    (NODE_ENV) => {
      expect(parseEnrollmentTestRuntime({ ...ci, NODE_ENV })).toEqual({
        mode: 'invalid',
      });
    },
  );
  it('rewrites only allowlisted Toss API paths to fixed loopback HTTP', async () => {
    const response = Response.json({ ok: true });
    const io = vi.fn().mockResolvedValue(response);
    const transport = createEnrollmentTransport({ mode: 'ci' }, io)!;
    const authorization = `Basic ${Buffer.from(`${ENROLLMENT_CI.tossSecretKey}:`).toString('base64')}`;
    await expect(
      transport(
        'https://api.tosspayments.com/v1/billing/authorizations/issue',
        {
          method: 'POST',
          headers: { Authorization: authorization },
          body: '{}',
        },
      ),
    ).resolves.toBe(response);
    expect(io).toHaveBeenCalledWith(
      'http://127.0.0.1:3200/toss/v1/billing/authorizations/issue',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        body: '{}',
      }),
    );
  });
  it('routes known Kakao query without inventing an idempotency header', async () => {
    const io = vi.fn().mockResolvedValue(Response.json({}));
    await createEnrollmentTransport({ mode: 'ci' }, io)!(
      'https://open-api.kakaopay.com/online/v1/payment/order',
      {
        method: 'POST',
        headers: {
          Authorization: `SECRET_KEY ${ENROLLMENT_CI.kakaoSecretKey}`,
        },
      },
    );
    expect(io.mock.calls[0]![0]).toBe(
      'http://127.0.0.1:3200/kakaopay/online/v1/payment/order',
    );
    expect(
      new Headers(io.mock.calls[0]![1].headers).has('Idempotency-Key'),
    ).toBe(false);
  });
  it.each([
    'https://api.tosspayments.com.evil.test/v1/billing/authorizations/issue',
    'https://evil.test/v1/billing/authorizations/issue',
    'https://api.tosspayments.com/v1/payments/secret/cancel',
    'https://api.tosspayments.com/v1/billing/authorizations/issue?secret=token',
    'https://api.tosspayments.com/v1/billing/authorizations/issue#fragment',
    'https://user:pass@api.tosspayments.com/v1/billing/authorizations/issue',
    'http://127.0.0.1:3200/toss/v1/billing/authorizations/issue',
  ])(
    'blocks arbitrary/noncanonical HTTP target %s before transport',
    async (url) => {
      const io = vi.fn();
      const transport = createEnrollmentTransport({ mode: 'ci' }, io)!;
      await expect(transport(url, { method: 'POST' })).rejects.toThrow(
        'CI_PAYMENT_TRANSPORT_REJECTED',
      );
      expect(io).not.toHaveBeenCalled();
    },
  );
  it('does not send nonfixture authorization to the local server', async () => {
    const io = vi.fn();
    await expect(
      createEnrollmentTransport({ mode: 'ci' }, io)!(
        'https://api.tosspayments.com/v1/billing/authorizations/issue',
        {
          method: 'POST',
          headers: { Authorization: 'Basic not-fixture-credentials' },
        },
      ),
    ).rejects.toThrow('CI_PAYMENT_TRANSPORT_REJECTED');
    expect(io).not.toHaveBeenCalled();
  });
  it('disables callback URL and argument logging in the actual Next configuration', () => {
    const source = readFileSync(
      new URL('../../next.config.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('logging: false');
    expect(source).not.toContain('fullUrl: false');
  });
});
