// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createCancellationFixtureState,
  cancellationFixtureResponse,
  type CancellationFixtureState,
} from '../../scripts/cancellation-local-ci-provider.mjs';
import { ENROLLMENT_CI } from '@/config/enrollment-test-runtime';
import { parseServerEnv } from '@/config/env.server';
import { createRefundTransport } from '@/server/adapters/payment/refund-ci-transport';
import { createTossRefundAdapter } from '@/server/adapters/payment/refund-toss';
import { createKakaoRefundAdapter } from '@/server/adapters/payment/refund-kakaopay';
import type { RefundInput } from '@/server/adapters/payment/refund';

const customer = 'da230000-0000-4000-8000-000000000001';
const order = 'da230000-0000-4000-8000-000000000002';
const attempt = 'da230000-0000-4000-8000-000000000003';
const tossAuthorization = `Basic ${Buffer.from(`${ENROLLMENT_CI.tossSecretKey}:`).toString('base64')}`;
const kakaoAuthorization = `SECRET_KEY ${ENROLLMENT_CI.kakaoSecretKey}`;
const raw = {
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
function request(
  state: CancellationFixtureState,
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
) {
  return cancellationFixtureResponse(state, {
    path,
    method: 'POST',
    body,
    headers,
  }).body;
}
function initial(state: CancellationFixtureState, provider: 'toss' | 'kakao') {
  if (provider === 'toss') {
    const value = request(
      state,
      `/toss/v1/billing/ci_billing_${customer}`,
      {
        customerKey: customer,
        orderId: order,
        amount: 1000,
        taxFreeAmount: 0,
      },
      { authorization: tossAuthorization, 'idempotency-key': order },
    );
    const parsed = z
      .object({ paymentKey: z.string(), lastTransactionKey: z.string() })
      .parse(value);
    return {
      payment: parsed.paymentKey,
      transaction: parsed.lastTransactionKey,
    };
  }
  const value = request(
    state,
    '/kakaopay/online/v1/payment/ready',
    {
      cid: ENROLLMENT_CI.kakaoCid,
      partner_order_id: order,
      partner_user_id: customer,
      total_amount: 1000,
      tax_free_amount: 0,
      approval_url: `${ENROLLMENT_CI.appOrigin}/api/checkout/return?outcome=success`,
      cancel_url: `${ENROLLMENT_CI.appOrigin}/api/checkout/return?outcome=cancel`,
      fail_url: `${ENROLLMENT_CI.appOrigin}/api/checkout/return?outcome=failure`,
    },
    { authorization: kakaoAuthorization },
  );
  const { tid } = z.object({ tid: z.string() }).parse(value);
  const approved = request(
    state,
    '/kakaopay/online/v1/payment/approve',
    {
      cid: ENROLLMENT_CI.kakaoCid,
      tid,
      partner_order_id: order,
      partner_user_id: customer,
      total_amount: 1000,
      pg_token: `ci_pg_${tid}`,
    },
    { authorization: kakaoAuthorization },
  );
  return {
    payment: tid,
    transaction: z.object({ aid: z.string() }).parse(approved).aid,
  };
}
function fixture(provider: 'toss' | 'kakao') {
  const state = createCancellationFixtureState();
  const before = initial(state, provider);
  const input: RefundInput = {
    attemptId: attempt,
    orderId: order,
    customerRef: customer,
    providerPaymentId: before.payment,
    originalProviderTransactionId: before.transaction,
    originalAmountKrw: 1000,
    amountKrw: 400,
    refundedBeforeKrw: 0,
    currency: 'KRW',
    taxBasis: 'taxable_krw',
  };
  const parsed = parseServerEnv(raw);
  if (!parsed.ok) throw new Error('CI_REFUND_FIXTURE_CONFIGURATION_INVALID');
  const transport = createRefundTransport(
    { mode: 'ci' },
    async (input, init) => {
      const url = new URL(input);
      expect(url.origin).toBe(ENROLLMENT_CI.providerOrigin);
      const result = cancellationFixtureResponse(state, {
        path: url.pathname,
        method: init.method ?? '',
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        body: init.body ? JSON.parse(String(init.body)) : {},
      });
      if (result.lost) throw new TypeError('Fixture response lost');
      return Response.json(result.body, { status: result.status ?? 500 });
    },
  )!;
  const adapter =
    provider === 'toss'
      ? createTossRefundAdapter(parsed.data, transport)
      : createKakaoRefundAdapter(parsed.data, transport);
  return { state, input, adapter };
}

describe('real refund adapter against pure loopback fixture contract (no sockets)', () => {
  for (const provider of ['toss', 'kakao'] as const) {
    it(`${provider} verifies exact partial refund and subsequent remaining refund`, async () => {
      const { state, input, adapter } = fixture(provider);
      const first = await adapter.refund(input);
      expect(first).toMatchObject({
        ok: true,
        data: { amountKrw: 400, cumulativeRefundedKrw: 400, remainingKrw: 600 },
      });
      const second = await adapter.refund({
        ...input,
        attemptId: 'da230000-0000-4000-8000-000000000004',
        amountKrw: 600,
        refundedBeforeKrw: 400,
      });
      expect(second).toMatchObject({
        ok: true,
        data: { amountKrw: 600, cumulativeRefundedKrw: 1000, remainingKrw: 0 },
      });
      expect(state.refunds[provider]).toBe(2);
    });
    it(`${provider} recovers lost response by exact action query only`, async () => {
      const { state, input, adapter } = fixture(provider);
      state.scenario = 'refund-response-lost';
      expect(await adapter.refund(input)).toMatchObject({
        ok: false,
        outcome: 'unknown',
      });
      expect(await adapter.query(input)).toMatchObject({
        ok: true,
        data: {
          attemptId: input.attemptId,
          amountKrw: 400,
          cumulativeRefundedKrw: 400,
          remainingKrw: 600,
        },
      });
      expect(state.refunds[provider]).toBe(1);
    });
    it(`${provider} does not turn refund error response into a safe retry`, async () => {
      const { state, input, adapter } = fixture(provider);
      state.scenario = 'refund-reject';
      expect(await adapter.refund(input)).toMatchObject({
        ok: false,
        outcome: 'unknown',
        retryAllowed: false,
      });
      expect(state.refunds[provider]).toBe(0);
    });
  }
});
