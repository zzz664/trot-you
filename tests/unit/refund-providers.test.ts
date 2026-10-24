// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseServerEnv, type ServerEnv } from '@/config/env.server';
import {
  ENROLLMENT_CHARGE_TIMEOUT_MS,
  ENROLLMENT_MAX_QUERY_ACTIONS,
  ENROLLMENT_QUERY_TIMEOUT_MS,
  KAKAOPAY_ORDER_URL,
  TOSS_API_ORIGIN,
} from '@/config/enrollment-provider';
import { PAYMENT_RESPONSE_MAX_BYTES } from '@/config/payment-preparation';
import {
  KAKAOPAY_REFUND_URL,
  TOSS_REFUND_PATH,
  TOSS_REFUND_SUFFIX,
} from '@/config/refund-provider';
import type { EnrollmentTransport } from '@/server/adapters/payment/enrollment';
import {
  refundOperationMarker,
  type RefundInput,
} from '@/server/adapters/payment/refund';
import { createKakaoRefundAdapter } from '@/server/adapters/payment/refund-kakaopay';
import { createTossRefundAdapter } from '@/server/adapters/payment/refund-toss';

const fixture = {
  NEXT_PUBLIC_APP_URL: 'https://app.example.test',
  PAYMENTS_MODE: 'test',
  TOSS_BILLING_ENABLED: 'true',
  KAKAOPAY_SUBSCRIPTION_ENABLED: 'true',
  NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_ck_fictional',
  TOSS_SECRET_KEY: 'test_sk_fictional',
  TOSS_BILLING_MID: 'fictional-mid',
  KAKAOPAY_SECRET_KEY: 'fictional-kakao-secret',
  KAKAOPAY_RECURRING_CID: 'TCSUBSCRIP',
};
function env(overrides: Record<string, string> = {}): ServerEnv {
  const result = parseServerEnv({ ...fixture, ...overrides });
  if (!result.ok) throw new Error('Invalid fixture environment');
  return result.data;
}
const input: RefundInput = {
  attemptId: 'a1800000-0000-4000-8000-000000000001',
  orderId: 'a1800000-0000-4000-8000-000000000002',
  customerRef: 'a1800000-0000-4000-8000-000000000003',
  providerPaymentId: 'fictional-original-payment',
  originalProviderTransactionId: 'fictional-original-charge-action',
  originalAmountKrw: 6500,
  amountKrw: 2000,
  refundedBeforeKrw: 1000,
  currency: 'KRW',
  taxBasis: 'taxable_krw',
};
const approvedAt = '2026-10-01T09:00:00+09:00';
const canceledAt = '2026-10-24T09:00:00+09:00';
const previousCanceledAt = '2026-10-23T09:00:00+09:00';
const marker = refundOperationMarker(input.attemptId);
const actionId = 'fictional-current-refund-action';
const tossPayment = {
  mId: fixture.TOSS_BILLING_MID,
  paymentKey: input.providerPaymentId,
  orderId: input.orderId,
  type: 'BILLING',
  method: '카드',
  currency: 'KRW',
  status: 'PARTIAL_CANCELED',
  totalAmount: input.originalAmountKrw,
  balanceAmount: 3500,
  taxFreeAmount: 0,
  taxExemptionAmount: 0,
  approvedAt,
  cancels: [
    {
      transactionKey: 'fictional-previous-refund-action',
      cancelReason: 'previous approved refund',
      cancelAmount: 1000,
      taxFreeAmount: 0,
      taxExemptionAmount: 0,
      refundableAmount: 5500,
      canceledAt: previousCanceledAt,
      cancelStatus: 'DONE',
    },
    {
      transactionKey: actionId,
      cancelReason: marker,
      cancelAmount: 2000,
      taxFreeAmount: 0,
      taxExemptionAmount: 0,
      refundableAmount: 3500,
      canceledAt,
      cancelStatus: 'DONE',
    },
  ],
  card: { number: 'discarded-private-provider-data' },
};
const kakaoPayment = {
  cid: fixture.KAKAOPAY_RECURRING_CID,
  tid: input.providerPaymentId,
  partner_order_id: input.orderId,
  partner_user_id: input.customerRef,
  payment_method_type: 'MONEY',
  status: 'PART_CANCEL_PAYMENT',
  amount: { total: 6500, tax_free: 0, vat: 591, green_deposit: 0 },
  canceled_amount: { total: 3000, tax_free: 0, vat: 273 },
  cancel_available_amount: { total: 3500, tax_free: 0, vat: 318 },
  approved_at: '2026-10-01T09:00:00',
  aid: actionId,
  payload: marker,
  approved_cancel_amount: { total: 2000, tax_free: 0, vat: 182 },
  canceled_at: '2026-10-24T09:00:00',
  selected_card_info: { number: 'discarded-private-provider-data' },
};
const kakaoOrder = {
  ...kakaoPayment,
  payment_action_details: [
    {
      aid: input.originalProviderTransactionId,
      payment_action_type: 'PAYMENT',
      amount: 6500,
      approved_at: '2026-10-01T09:00:00',
    },
    {
      aid: 'fictional-previous-refund-action',
      payment_action_type: 'CANCEL',
      amount: 1000,
      approved_at: '2026-10-23T09:00:00',
      payload: 'previous-approved-refund',
    },
    {
      aid: actionId,
      payment_action_type: 'CANCEL',
      amount: 2000,
      approved_at: '2026-10-24T09:00:00',
      payload: marker,
    },
  ],
};
const unknown = {
  ok: false,
  code: 'OUTCOME_UNKNOWN',
  outcome: 'unknown',
  retryAllowed: false,
};
const invalid = {
  ok: false,
  code: 'INVALID_INPUT',
  outcome: 'not_started',
  retryAllowed: false,
};
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
  });
}
function http(value: unknown, status = 200) {
  return vi.fn<EnrollmentTransport>(async () => json(value, status));
}
function expected(merchantAccount: string) {
  return {
    ok: true,
    data: {
      ...input,
      providerTransactionId: actionId,
      refundedAt: '2026-10-24T00:00:00.000Z',
      cumulativeRefundedKrw: 3000,
      remainingKrw: 3500,
      merchantAccount,
    },
  };
}
beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('External payment I/O forbidden');
    }),
  ),
);
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Toss refunds, fictional transport only', () => {
  it('sends one exact bounded POST with stable idempotency and no customer reason/credential', async () => {
    const transport = http(tossPayment);
    expect(
      await createTossRefundAdapter(env(), transport).refund(input),
    ).toEqual(expected(fixture.TOSS_BILLING_MID));
    expect(transport).toHaveBeenCalledOnce();
    const [url, request] = transport.mock.calls[0]!;
    expect(url).toBe(
      `${TOSS_API_ORIGIN}${TOSS_REFUND_PATH}${input.providerPaymentId}${TOSS_REFUND_SUFFIX}`,
    );
    expect(request).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        Authorization: `Basic ${Buffer.from(`${fixture.TOSS_SECRET_KEY}:`).toString('base64')}`,
        'Idempotency-Key': input.attemptId,
      },
    });
    expect(JSON.parse(request.body as string)).toEqual({
      cancelReason: marker,
      cancelAmount: 2000,
      currency: 'KRW',
      taxFreeAmount: 0,
      refundableAmount: 5500,
    });
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });
  it('reconciles with GET only and selects the exact reason marker rather than lastTransactionKey', async () => {
    const transport = http({
      ...tossPayment,
      lastTransactionKey: 'irrelevant-last-field',
      cancels: [...tossPayment.cancels].reverse(),
    });
    expect(
      await createTossRefundAdapter(env(), transport).query(input),
    ).toEqual(expected(fixture.TOSS_BILLING_MID));
    const [url, request] = transport.mock.calls[0]!;
    expect(url).toBe(
      `${TOSS_API_ORIGIN}${TOSS_REFUND_PATH}${input.providerPaymentId}`,
    );
    expect(request.method).toBe('GET');
    expect(request.body).toBeUndefined();
    expect(request.headers).not.toHaveProperty('Idempotency-Key');
    expect(transport).toHaveBeenCalledOnce();
  });
  it('rejects path/query injection in a provider transaction identity before network', async () => {
    const paymentKey = 'fixture/key?encoding=#';
    const transport = http({ ...tossPayment, paymentKey });
    expect(
      await createTossRefundAdapter(env(), transport).refund({
        ...input,
        providerPaymentId: paymentKey,
      }),
    ).toEqual(invalid);
    expect(transport).not.toHaveBeenCalled();
  });
  it('accepts full remaining-balance cancellation without manufacturing a refund of the original total', async () => {
    const full = { ...input, amountKrw: 5500 };
    const transport = http({
      ...tossPayment,
      status: 'CANCELED',
      balanceAmount: 0,
      cancels: [
        tossPayment.cancels[0],
        { ...tossPayment.cancels[1], cancelAmount: 5500, refundableAmount: 0 },
      ],
    });
    expect(
      await createTossRefundAdapter(env(), transport).refund(full),
    ).toMatchObject({
      ok: true,
      data: { amountKrw: 5500, cumulativeRefundedKrw: 6500, remainingKrw: 0 },
    });
  });
  it.each([
    { mId: 'wrong-mid' },
    { paymentKey: 'wrong-payment' },
    { orderId: input.attemptId },
    { type: 'NORMAL' },
    { method: '가상계좌' },
    { currency: 'USD' },
    { totalAmount: 6499 },
    { balanceAmount: 3499 },
    { taxFreeAmount: 1 },
    { taxExemptionAmount: 1 },
    { status: 'DONE' },
    { status: 'CANCELED' },
    { approvedAt: '2026-10-25T00:00:00Z' },
    { cancels: [] },
  ])('rejects response identity/tax/status mismatch %j', async (patch) => {
    expect(
      await createTossRefundAdapter(
        env(),
        http({ ...tossPayment, ...patch }),
      ).refund(input),
    ).toEqual(unknown);
  });
  it.each([
    { cancelReason: 'unrelated refund with same amount' },
    { cancelAmount: 1999 },
    { refundableAmount: 3501 },
    { transactionKey: input.originalProviderTransactionId },
    { transactionKey: tossPayment.cancels[0]!.transactionKey },
    { taxFreeAmount: 1 },
    { taxExemptionAmount: 1 },
    { cancelStatus: 'PENDING' },
    { canceledAt: 'invalid-time' },
  ])(
    'never recognizes an unrelated/incomplete cancellation %j',
    async (patch) => {
      expect(
        await createTossRefundAdapter(
          env(),
          http({
            ...tossPayment,
            cancels: [
              tossPayment.cancels[0],
              { ...tossPayment.cancels[1], ...patch },
            ],
          }),
        ).query(input),
      ).toEqual(unknown);
    },
  );
  it('rejects duplicated markers, invalid historical totals, later unrelated refunds, and unbounded action lists', async () => {
    for (const cancels of [
      [tossPayment.cancels[1], tossPayment.cancels[1]],
      [
        { ...tossPayment.cancels[0], cancelAmount: 999 },
        tossPayment.cancels[1],
      ],
      [
        { ...tossPayment.cancels[0], canceledAt: '2026-10-25T00:00:00Z' },
        tossPayment.cancels[1],
      ],
      Array.from(
        { length: ENROLLMENT_MAX_QUERY_ACTIONS + 1 },
        () => tossPayment.cancels[1],
      ),
    ])
      expect(
        await createTossRefundAdapter(
          env(),
          http({ ...tossPayment, cancels }),
        ).query(input),
      ).toEqual(unknown);
  });
});

describe('Kakao refunds, fictional transport only', () => {
  it('sends one cancel with a recoverable payload and original auto-VAT treatment, no invented idempotency', async () => {
    const transport = http(kakaoPayment);
    expect(
      await createKakaoRefundAdapter(env(), transport).refund(input),
    ).toEqual(expected(fixture.KAKAOPAY_RECURRING_CID));
    expect(transport).toHaveBeenCalledOnce();
    const [url, request] = transport.mock.calls[0]!;
    expect(url).toBe(KAKAOPAY_REFUND_URL);
    expect(request).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      headers: { Authorization: `SECRET_KEY ${fixture.KAKAOPAY_SECRET_KEY}` },
    });
    expect(request.headers).not.toHaveProperty('Idempotency-Key');
    expect(JSON.parse(request.body as string)).toEqual({
      cid: fixture.KAKAOPAY_RECURRING_CID,
      tid: input.providerPaymentId,
      cancel_amount: 2000,
      cancel_tax_free_amount: 0,
      cancel_available_amount: 5500,
      payload: marker,
    });
  });
  it('queries only known TID and requires the original PAYMENT plus exact CANCEL payload', async () => {
    const transport = http({
      ...kakaoOrder,
      payment_action_details: [...kakaoOrder.payment_action_details].reverse(),
    });
    expect(
      await createKakaoRefundAdapter(env(), transport).query(input),
    ).toEqual(expected(fixture.KAKAOPAY_RECURRING_CID));
    expect(transport).toHaveBeenCalledOnce();
    const [url, request] = transport.mock.calls[0]!;
    expect(url).toBe(KAKAOPAY_ORDER_URL);
    expect(JSON.parse(request.body as string)).toEqual({
      cid: fixture.KAKAOPAY_RECURRING_CID,
      tid: input.providerPaymentId,
    });
  });
  it('retains optional merchant-issued CID secret only on the server request', async () => {
    const transport = http(kakaoPayment);
    const result = await createKakaoRefundAdapter(
      env({ KAKAOPAY_CID_SECRET: 'fictional-cid-secret' }),
      transport,
    ).refund(input);
    expect(result).toEqual(expected(fixture.KAKAOPAY_RECURRING_CID));
    expect(
      JSON.parse(transport.mock.calls[0]![1].body as string),
    ).toHaveProperty('cid_secret', 'fictional-cid-secret');
    expect(JSON.stringify(result)).not.toContain('fictional-cid-secret');
  });
  it('normalizes offsetless Korean times independently of host timezone and supports full cancellation', async () => {
    const transport = http({
      ...kakaoPayment,
      status: 'CANCEL_PAYMENT',
      approved_cancel_amount: { total: 5500, tax_free: 0 },
      canceled_amount: { total: 6500, tax_free: 0 },
      cancel_available_amount: { total: 0, tax_free: 0 },
    });
    expect(
      await createKakaoRefundAdapter(env(), transport).refund({
        ...input,
        amountKrw: 5500,
      }),
    ).toMatchObject({
      ok: true,
      data: {
        amountKrw: 5500,
        remainingKrw: 0,
        cumulativeRefundedKrw: 6500,
        refundedAt: '2026-10-24T00:00:00.000Z',
      },
    });
  });
  it.each([
    { cid: 'wrong-cid' },
    { tid: 'wrong-tid' },
    { partner_order_id: input.attemptId },
    { partner_user_id: input.attemptId },
    { payment_method_type: 'OTHER' },
    { status: 'SUCCESS_PAYMENT' },
    { status: 'CANCEL_PAYMENT' },
    { amount: { total: 6501, tax_free: 0 } },
    { canceled_amount: { total: 3001, tax_free: 0 } },
    { cancel_available_amount: { total: 3501, tax_free: 0 } },
    { approved_cancel_amount: { total: 2001, tax_free: 0 } },
    { payload: 'another-refund' },
    { aid: input.originalProviderTransactionId },
    { canceled_at: '2026-09-01T00:00:00' },
    { approved_cancel_amount: { total: 2000, tax_free: 1 } },
    { amount: { total: 6500, tax_free: 0, green_deposit: 1 } },
  ])('rejects refund response mismatch %j', async (patch) => {
    expect(
      await createKakaoRefundAdapter(
        env(),
        http({ ...kakaoPayment, ...patch }),
      ).refund(input),
    ).toEqual(unknown);
  });
  it.each([
    { payload: undefined },
    { payload: 'unrelated-refund' },
    { amount: 2001 },
    { payment_action_type: 'PAYMENT' },
    { aid: input.originalProviderTransactionId },
    { approved_at: '2026-09-01T00:00:00' },
    { green_deposit: 1 },
  ])(
    'does not recognize cumulative amount or a missing/mismatched query marker %j',
    async (patch) => {
      const payment_action_details = [
        ...kakaoOrder.payment_action_details.slice(0, -1),
        { ...kakaoOrder.payment_action_details[2], ...patch },
      ];
      expect(
        await createKakaoRefundAdapter(
          env(),
          http({ ...kakaoOrder, payment_action_details }),
        ).query(input),
      ).toEqual(unknown);
    },
  );
  it('rejects missing/mismatched original action, duplicate IDs/markers, stale totals, and excessive details', async () => {
    for (const payment_action_details of [
      kakaoOrder.payment_action_details.slice(1),
      [
        { ...kakaoOrder.payment_action_details[0], aid: 'wrong-charge-action' },
        ...kakaoOrder.payment_action_details.slice(1),
      ],
      [
        { ...kakaoOrder.payment_action_details[0], amount: 6499 },
        ...kakaoOrder.payment_action_details.slice(1),
      ],
      [
        {
          ...kakaoOrder.payment_action_details[0],
          approved_at: '2026-10-02T09:00:00',
        },
        ...kakaoOrder.payment_action_details.slice(1),
      ],
      [
        ...kakaoOrder.payment_action_details,
        kakaoOrder.payment_action_details[2],
      ],
      [
        kakaoOrder.payment_action_details[0],
        { ...kakaoOrder.payment_action_details[1], amount: 999 },
        kakaoOrder.payment_action_details[2],
      ],
      [
        kakaoOrder.payment_action_details[0],
        {
          ...kakaoOrder.payment_action_details[1],
          approved_at: '2026-10-25T09:00:00',
        },
        kakaoOrder.payment_action_details[2],
      ],
      Array.from(
        { length: ENROLLMENT_MAX_QUERY_ACTIONS + 1 },
        () => kakaoOrder.payment_action_details[2],
      ),
    ])
      expect(
        await createKakaoRefundAdapter(
          env(),
          http({ ...kakaoOrder, payment_action_details }),
        ).query(input),
      ).toEqual(unknown);
  });
});

for (const provider of [
  { name: 'Toss', factory: createTossRefundAdapter, response: tossPayment },
  { name: 'Kakao', factory: createKakaoRefundAdapter, response: kakaoPayment },
])
  describe(`${provider.name} refund safety boundary`, () => {
    it.each([
      { attemptId: 'not-a-uuid' },
      { providerPaymentId: '' },
      { originalProviderTransactionId: '' },
      { amountKrw: 0 },
      { amountKrw: -1 },
      { amountKrw: 0.5 },
      { amountKrw: 5501 },
      { refundedBeforeKrw: -1 },
      { refundedBeforeKrw: 6500 },
      { originalAmountKrw: 0 },
      { currency: 'USD' },
      { taxBasis: 'exempt' },
      { reason: 'customer private text' },
    ])('fails invalid input before network %j', async (patch) => {
      const transport = http(provider.response);
      const adapter = provider.factory(env(), transport);
      expect(
        await adapter.refund({ ...input, ...patch } as RefundInput),
      ).toEqual(invalid);
      expect(
        await adapter.query({ ...input, ...patch } as RefundInput),
      ).toEqual(invalid);
      expect(transport).not.toHaveBeenCalled();
    });
    it('fails missing/disabled integration before network, never substituting mock success', async () => {
      for (const overrides of [
        { PAYMENTS_MODE: 'disabled' },
        { TOSS_SECRET_KEY: '', KAKAOPAY_SECRET_KEY: '' },
      ]) {
        const transport = http(provider.response);
        expect(
          (await provider.factory(env(overrides), transport).refund(input)).ok,
        ).toBe(false);
        expect(transport).not.toHaveBeenCalled();
      }
    });
    it.each([400, 401, 404, 408, 409, 429, 500])(
      'treats HTTP %i as uncertain without retry or leaking provider errors',
      async (status) => {
        const transport = http(
          {
            code: 'ALREADY_CANCELED_PAYMENT',
            error_code: -781,
            message: 'secret private provider diagnostic',
          },
          status,
        );
        expect(await provider.factory(env(), transport).refund(input)).toEqual(
          unknown,
        );
        expect(transport).toHaveBeenCalledOnce();
        expect(await provider.factory(env(), transport).query(input)).toEqual(
          unknown,
        );
        expect(transport).toHaveBeenCalledTimes(2);
      },
    );
    it('turns network failure, redirects, non-JSON, invalid JSON and excessive body into unknown', async () => {
      for (const transport of [
        vi.fn<EnrollmentTransport>(async () => {
          throw new Error('private credential payload');
        }),
        vi.fn<EnrollmentTransport>(
          async () =>
            new Response('{}', {
              status: 302,
              headers: {
                location: 'https://untrusted.invalid',
                'Content-Type': 'application/json',
              },
            }),
        ),
        vi.fn<EnrollmentTransport>(
          async () =>
            new Response('sensitive html', {
              headers: { 'Content-Type': 'text/html' },
            }),
        ),
        vi.fn<EnrollmentTransport>(
          async () =>
            new Response('{bad', {
              headers: { 'Content-Type': 'application/json' },
            }),
        ),
        http({ extra: 'x'.repeat(PAYMENT_RESPONSE_MAX_BYTES + 1) }),
      ]) {
        expect(await provider.factory(env(), transport).refund(input)).toEqual(
          unknown,
        );
        expect(transport).toHaveBeenCalledOnce();
      }
    });
    it.each(['refund', 'query'] as const)(
      'bounds a stalled %s and never automatically repeats it',
      async (method) => {
        vi.useFakeTimers();
        const transport = vi.fn<EnrollmentTransport>(
          () => new Promise(() => undefined),
        );
        const result = provider.factory(env(), transport)[method](input);
        await vi.advanceTimersByTimeAsync(
          method === 'query'
            ? ENROLLMENT_QUERY_TIMEOUT_MS
            : ENROLLMENT_CHARGE_TIMEOUT_MS,
        );
        expect(await result).toEqual(unknown);
        expect(transport).toHaveBeenCalledOnce();
        expect(transport.mock.calls[0]![1].signal?.aborted).toBe(true);
      },
    );
    it('bounds a body that stalls after success headers', async () => {
      vi.useFakeTimers();
      const transport = vi.fn<EnrollmentTransport>(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{'));
              },
            }),
            { headers: { 'Content-Type': 'application/json' } },
          ),
      );
      const result = provider.factory(env(), transport).refund(input);
      await vi.advanceTimersByTimeAsync(ENROLLMENT_CHARGE_TIMEOUT_MS);
      expect(await result).toEqual(unknown);
      expect(transport).toHaveBeenCalledOnce();
    });
  });
