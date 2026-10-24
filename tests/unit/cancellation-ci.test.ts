// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ENROLLMENT_CI } from '@/config/enrollment-test-runtime';
import { parseCancellationTestRuntime } from '@/config/cancellation-test-runtime';
import { createRefundTransport } from '@/server/adapters/payment/refund-ci-transport';

const complete = {
  CANCELLATION_LOCAL_E2E: 'true',
  PAYMENTS_REFUNDS_ENABLED: 'true',
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
const tossHeaders = {
  Authorization: `Basic ${Buffer.from(`${ENROLLMENT_CI.tossSecretKey}:`).toString('base64')}`,
};
const kakaoHeaders = {
  Authorization: `SECRET_KEY ${ENROLLMENT_CI.kakaoSecretKey}`,
};
describe('separate refund fixture capability', () => {
  it('accepts only complete guarded cancellation runtime', () => {
    expect(parseCancellationTestRuntime(complete)).toEqual({ mode: 'ci' });
  });
  it.each(Object.keys(complete))('rejects altered prerequisite %s', (key) => {
    expect(
      parseCancellationTestRuntime({ ...complete, [key]: 'wrong' }),
    ).toEqual({ mode: 'invalid' });
  });
  it.each(['VERCEL', 'VERCEL_ENV', 'NETLIFY', 'AWS_LAMBDA_FUNCTION_NAME'])(
    'rejects deployment indicator %s',
    (key) => {
      expect(
        parseCancellationTestRuntime({ ...complete, [key]: 'present' }),
      ).toEqual({ mode: 'invalid' });
    },
  );
  it.each(['true', 'wrong', null, false, 1])(
    'rejects partial active flag %s',
    (flag) => {
      expect(
        parseCancellationTestRuntime({
          CANCELLATION_LOCAL_E2E: flag,
          NODE_ENV: 'production',
        }),
      ).toEqual({ mode: 'invalid' });
    },
  );
  it.each([undefined, '', 'false'])(
    'does not grant refund capability to enrollment fixture with flag %s',
    (flag) => {
      expect(
        parseCancellationTestRuntime({
          ...complete,
          CANCELLATION_LOCAL_E2E: flag,
        }),
      ).toEqual({ mode: 'invalid' });
      expect(
        parseCancellationTestRuntime({
          ...complete,
          CANCELLATION_LOCAL_E2E: flag,
          PAYMENTS_REFUNDS_ENABLED: 'false',
        }),
      ).toEqual({ mode: 'unavailable' });
      expect(
        parseCancellationTestRuntime({
          NODE_ENV: 'production',
          CANCELLATION_LOCAL_E2E: flag,
        }),
      ).toEqual({ mode: 'real' });
    },
  );
  it.each(['invalid', 'unavailable'] as const)(
    'returns no transport in %s mode',
    (mode) => {
      expect(createRefundTransport({ mode }, vi.fn())).toBeNull();
    },
  );
  it('preserves ordinary real HTTP transport without mock success', () => {
    const real = vi.fn();
    expect(createRefundTransport({ mode: 'real' }, real)).toBe(real);
  });
});
describe('refund loopback allowlist', () => {
  it.each([
    [
      'https://api.tosspayments.com/v1/payments/ci_payment_key/cancel',
      'POST',
      '/toss/v1/payments/ci_payment_key/cancel',
      tossHeaders,
    ],
    [
      'https://api.tosspayments.com/v1/payments/ci_payment_key',
      'GET',
      '/toss/v1/payments/ci_payment_key',
      tossHeaders,
    ],
    [
      'https://open-api.kakaopay.com/online/v1/payment/cancel',
      'POST',
      '/kakaopay/online/v1/payment/cancel',
      kakaoHeaders,
    ],
    [
      'https://open-api.kakaopay.com/online/v1/payment/order',
      'POST',
      '/kakaopay/online/v1/payment/order',
      kakaoHeaders,
    ],
  ] as const)(
    'maps only canonical refund operation %s',
    async (url, method, path, headers) => {
      const response = Response.json({});
      const transport = vi.fn().mockResolvedValue(response);
      const run = createRefundTransport({ mode: 'ci' }, transport)!;
      await expect(run(url, { method, headers })).resolves.toBe(response);
      expect(transport).toHaveBeenCalledExactlyOnceWith(
        `${ENROLLMENT_CI.providerOrigin}${path}`,
        expect.objectContaining({
          method,
          redirect: 'error',
          cache: 'no-store',
          credentials: 'omit',
        }),
      );
    },
  );
  it.each([
    ['https://api.tosspayments.com/v1/payments/ci_payment_key/cancel', 'GET'],
    ['https://api.tosspayments.com/v1/payments/ci_payment_key', 'POST'],
    ['https://api.tosspayments.com/v1/billing/key', 'POST'],
    ['https://api.tosspayments.com/v1/payments/orders/order', 'GET'],
    ['https://api.tosspayments.com/v1/payments/key?token=secret', 'GET'],
    ['https://open-api.kakaopay.com/online/v1/payment/subscription', 'POST'],
    [
      'https://open-api.kakaopay.com/online/v1/payment/manage/subscription/inactive',
      'POST',
    ],
    ['https://open-api.kakaopay.com/online/v1/payment/cancel', 'GET'],
    [
      'https://open-api.kakaopay.com.evil.test/online/v1/payment/cancel',
      'POST',
    ],
    ['http://127.0.0.1:3200/kakaopay/online/v1/payment/cancel', 'POST'],
    [
      'https://user:password@api.tosspayments.com/v1/payments/key/cancel',
      'POST',
    ],
    ['https://api.tosspayments.com/v1/payments/key#fragment', 'GET'],
  ])(
    'rejects noncanonical/method/provider-expanding request %s',
    async (url, method) => {
      const transport = vi.fn();
      const run = createRefundTransport({ mode: 'ci' }, transport)!;
      await expect(
        run(url!, {
          method: method!,
          headers: url!.includes('tosspayments') ? tossHeaders : kakaoHeaders,
        }),
      ).rejects.toThrow('CI_REFUND_TRANSPORT_REJECTED');
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it('rejects private/nonfixture authorization before I/O', async () => {
    const transport = vi.fn();
    await expect(
      createRefundTransport({ mode: 'ci' }, transport)!(
        'https://api.tosspayments.com/v1/payments/key/cancel',
        { method: 'POST', headers: { Authorization: 'Basic not-fixture' } },
      ),
    ).rejects.toThrow('CI_REFUND_TRANSPORT_REJECTED');
    expect(transport).not.toHaveBeenCalled();
  });
});
