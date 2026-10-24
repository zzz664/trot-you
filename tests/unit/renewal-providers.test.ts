// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseServerEnv, type ServerEnv } from '@/config/env.server';
import {
  ENROLLMENT_CHARGE_TIMEOUT_MS,
  ENROLLMENT_QUERY_TIMEOUT_MS,
  KAKAOPAY_ORDER_URL,
  TOSS_API_ORIGIN,
  TOSS_DEFINITE_REJECTION_CODES,
  TOSS_ORDER_QUERY_PATH,
} from '@/config/enrollment-provider';
import {
  KAKAOPAY_SUBSCRIPTION_URL,
  RENEWAL_PROVIDER_ITEM_NAME,
  TOSS_RENEWAL_RETRYABLE_REJECTIONS,
} from '@/config/renewal-provider';
import { PAYMENT_RESPONSE_MAX_BYTES } from '@/config/payment-preparation';
import type { EnrollmentTransport } from '@/server/adapters/payment/enrollment';
import { createKakaoRenewalAdapter } from '@/server/adapters/payment/renewal-kakaopay';
import { createTossRenewalAdapter } from '@/server/adapters/payment/renewal-toss';

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
  const parsed = parseServerEnv({ ...fixture, ...overrides });
  if (!parsed.ok) throw new Error('Invalid fixture configuration');
  return parsed.data;
}
const identity = {
  customerRef: 'a1700000-0000-4000-8000-000000000001',
  orderId: 'a1700000-0000-4000-8000-000000000002',
  amountKrw: 6500,
};
const charge = {
  ...identity,
  credential: 'fictional-recurring-credential',
  idempotencyKey: 'a1700000-0000-4000-8000-000000000003',
};
const tossPayment = {
  mId: fixture.TOSS_BILLING_MID,
  type: 'BILLING',
  orderId: identity.orderId,
  status: 'DONE',
  method: '카드',
  currency: 'KRW',
  totalAmount: identity.amountKrw,
  balanceAmount: identity.amountKrw,
  taxFreeAmount: 0,
  taxExemptionAmount: 0,
  approvedAt: '2026-11-24T09:00:00+09:00',
  paymentKey: 'fictional-renewal-payment',
  lastTransactionKey: 'fictional-renewal-action',
  card: { number: 'fictional-discarded-card-detail' },
};
const kakaoPayment = {
  cid: fixture.KAKAOPAY_RECURRING_CID,
  sid: charge.credential,
  tid: 'fictional-new-renewal-tid',
  aid: 'fictional-new-renewal-aid',
  partner_order_id: identity.orderId,
  partner_user_id: identity.customerRef,
  payment_method_type: 'MONEY',
  amount: { total: identity.amountKrw, tax_free: 0, green_deposit: 0 },
  approved_at: '2026-11-24T09:00:00',
  card_info: { number: 'fictional-discarded-card-detail' },
};
const kakaoOrder = {
  ...kakaoPayment,
  sid: undefined,
  aid: undefined,
  status: 'SUCCESS_PAYMENT',
  canceled_amount: { total: 0 },
  payment_action_details: [
    {
      aid: kakaoPayment.aid,
      payment_action_type: 'PAYMENT',
      amount: identity.amountKrw,
      approved_at: kakaoPayment.approved_at,
    },
  ],
};
const expectedToss = {
  ...identity,
  providerPaymentId: tossPayment.paymentKey,
  providerTransactionId: tossPayment.lastTransactionKey,
  merchantAccount: fixture.TOSS_BILLING_MID,
  currency: 'KRW',
  approvedAt: '2026-11-24T00:00:00.000Z',
};
const expectedKakao = {
  ...identity,
  providerPaymentId: kakaoPayment.tid,
  providerTransactionId: kakaoPayment.aid,
  merchantAccount: fixture.KAKAOPAY_RECURRING_CID,
  currency: 'KRW',
  approvedAt: '2026-11-24T00:00:00.000Z',
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
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('External provider calls forbidden');
    }),
  );
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Toss renewal HTTP contract with fictional transport', () => {
  it('dispatches only one exact charge with the stored order/idempotency identity', async () => {
    const transport = http(tossPayment);
    const result = await createTossRenewalAdapter(env(), transport).charge({
      ...charge,
      credential: 'fixture/key?encoding=#',
    });
    expect(result).toEqual({ ok: true, data: expectedToss });
    expect(transport).toHaveBeenCalledOnce();
    const [url, request] = transport.mock.calls[0]!;
    expect(url).toBe(
      `${TOSS_API_ORIGIN}/v1/billing/fixture%2Fkey%3Fencoding%3D%23`,
    );
    expect(request).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${fixture.TOSS_SECRET_KEY}:`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': charge.idempotencyKey,
      },
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    });
    expect(JSON.parse(request.body as string)).toEqual({
      customerKey: identity.customerRef,
      orderId: identity.orderId,
      amount: identity.amountKrw,
      orderName: RENEWAL_PROVIDER_ITEM_NAME,
      taxFreeAmount: 0,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /credential|idempotencyKey|discarded-card|SECRET|test_sk/,
    );
  });
  it.each(TOSS_DEFINITE_REJECTION_CODES)(
    'classifies documented definitive %s without any implicit HTTP retry',
    async (code) => {
      const transport = http(
        { code, message: 'fictional-private-message' },
        403,
      );
      const result = await createTossRenewalAdapter(env(), transport).charge(
        charge,
      );
      expect(result).toEqual({
        ok: false,
        code: 'PROVIDER_REJECTED',
        outcome: 'rejected',
        retryAllowed: false,
        failureDisposition: TOSS_RENEWAL_RETRYABLE_REJECTIONS.some(
          (known) => known === code,
        )
          ? 'retryable'
          : 'customer_action',
      });
      expect(transport).toHaveBeenCalledOnce();
      expect(JSON.stringify(result)).not.toContain('fictional-private-message');
      expect(JSON.stringify(result)).not.toContain(code);
    },
  );
  it.each([
    'ALREADY_PROCESSED_PAYMENT',
    'IDEMPOTENT_REQUEST_PROCESSING',
    'PROVIDER_ERROR',
    'FAILED_BILLING_AUTO_CANCEL',
    'UNKNOWN_PAYMENT_ERROR',
    'UNRECOGNIZED',
  ])('leaves ambiguous error %s unknown and held', async (code) => {
    const transport = http({ code }, 400);
    expect(
      await createTossRenewalAdapter(env(), transport).charge(charge),
    ).toEqual(unknown);
    expect(transport).toHaveBeenCalledOnce();
  });
  it.each([
    { mId: 'different-merchant' },
    { orderId: identity.customerRef },
    { type: 'NORMAL' },
    { status: 'IN_PROGRESS' },
    { status: 'CANCELED' },
    { status: 'PARTIAL_CANCELED' },
    { method: '계좌이체' },
    { currency: 'USD' },
    { totalAmount: 1000 },
    { totalAmount: 6500.5 },
    { balanceAmount: 6499 },
    { taxFreeAmount: 1 },
    { taxFreeAmount: undefined },
    { taxExemptionAmount: 1 },
    { taxExemptionAmount: undefined },
    { approvedAt: '2026-02-30T00:00:00Z' },
    { approvedAt: '2026-11-24T09:00:00' },
    { paymentKey: '' },
    { lastTransactionKey: null },
  ])('holds inconsistent charge evidence %#', async (override) => {
    expect(
      await createTossRenewalAdapter(
        env(),
        http({ ...tossPayment, ...override }),
      ).charge(charge),
    ).toEqual(unknown);
  });
  it('reconciles by original order without another billing request', async () => {
    const transport = http(tossPayment);
    expect(
      await createTossRenewalAdapter(env(), transport).query(identity),
    ).toEqual({ ok: true, data: expectedToss });
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]![0]).toBe(
      `${TOSS_API_ORIGIN}${TOSS_ORDER_QUERY_PATH}${identity.orderId}`,
    );
    expect(transport.mock.calls[0]![1]).toMatchObject({ method: 'GET' });
    expect(transport.mock.calls[0]![1].body).toBeUndefined();
    expect(transport.mock.calls[0]![1].headers).not.toHaveProperty(
      'Idempotency-Key',
    );
  });
  it('requires an already known payment ID to match the queried order', async () => {
    const adapter = createTossRenewalAdapter(env(), http(tossPayment));
    expect(
      await adapter.query({
        ...identity,
        providerPaymentId: 'different-payment-id',
      }),
    ).toEqual(unknown);
    expect(
      await adapter.query({
        ...identity,
        providerPaymentId: tossPayment.paymentKey,
      }),
    ).toEqual({ ok: true, data: expectedToss });
  });
  it.each([400, 403, 404, 408, 409, 429, 500])(
    'never converts query failure HTTP %s into a retryable charge',
    async (status) => {
      expect(
        await createTossRenewalAdapter(
          env(),
          http({ code: 'REJECT_CARD_PAYMENT' }, status),
        ).query(identity),
      ).toEqual(unknown);
    },
  );
  it('does not leak rejection classification between simultaneous calls', async () => {
    const transport = vi
      .fn<EnrollmentTransport>()
      .mockResolvedValueOnce(json({ code: 'REJECT_CARD_PAYMENT' }, 403))
      .mockResolvedValueOnce(json({ code: 'INVALID_STOPPED_CARD' }, 400))
      .mockResolvedValueOnce(json({ code: 'UNKNOWN_PAYMENT_ERROR' }, 500));
    const adapter = createTossRenewalAdapter(env(), transport);
    const results = await Promise.all([
      adapter.charge(charge),
      adapter.charge({ ...charge, orderId: charge.idempotencyKey }),
      adapter.charge({ ...charge, orderId: charge.customerRef }),
    ]);
    expect(results[0]).toMatchObject({ failureDisposition: 'retryable' });
    expect(results[1]).toMatchObject({ failureDisposition: 'customer_action' });
    expect(results[2]).toEqual(unknown);
    expect(transport).toHaveBeenCalledTimes(3);
  });
});

describe('Kakao renewal HTTP contract with fictional transport', () => {
  it.each(['MONEY', 'CARD'])(
    'charges SID once with original customer binding using %s',
    async (method) => {
      const transport = http({ ...kakaoPayment, payment_method_type: method });
      const result = await createKakaoRenewalAdapter(env(), transport).charge(
        charge,
      );
      expect(result).toEqual({ ok: true, data: expectedKakao });
      expect(transport).toHaveBeenCalledOnce();
      const [url, request] = transport.mock.calls[0]!;
      expect(url).toBe(KAKAOPAY_SUBSCRIPTION_URL);
      expect(request).toMatchObject({
        method: 'POST',
        headers: {
          Authorization: `SECRET_KEY ${fixture.KAKAOPAY_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
      });
      expect(request.headers).not.toHaveProperty('Idempotency-Key');
      expect(JSON.parse(request.body as string)).toEqual({
        cid: fixture.KAKAOPAY_RECURRING_CID,
        sid: charge.credential,
        partner_order_id: identity.orderId,
        partner_user_id: identity.customerRef,
        item_name: RENEWAL_PROVIDER_ITEM_NAME,
        quantity: 1,
        total_amount: identity.amountKrw,
        tax_free_amount: 0,
      });
      expect(JSON.stringify(result)).not.toMatch(
        /credential|idempotencyKey|sid|discarded-card|secret/,
      );
    },
  );
  it('includes cid_secret only when explicitly configured', async () => {
    const transport = http(kakaoPayment);
    await createKakaoRenewalAdapter(
      env({ KAKAOPAY_CID_SECRET: 'fictional-cid-secret' }),
      transport,
    ).charge(charge);
    expect(
      JSON.parse(transport.mock.calls[0]![1].body as string),
    ).toHaveProperty('cid_secret', 'fictional-cid-secret');
  });
  it.each([
    { cid: 'different-cid' },
    { sid: 'different-sid' },
    { sid: undefined },
    { tid: '' },
    { aid: undefined },
    { partner_order_id: identity.customerRef },
    { partner_user_id: identity.orderId },
    { payment_method_type: 'CARRIER' },
    { amount: { total: 1000, tax_free: 0 } },
    { amount: { total: 6500.5, tax_free: 0 } },
    { amount: { total: 6500, tax_free: 1 } },
    { amount: { total: 6500 } },
    { amount: { total: 6500, tax_free: 0, green_deposit: 100 } },
    { approved_at: null },
    { approved_at: '2026-02-30T09:00:00' },
    { approved_at: '2026-11-24' },
  ])('holds wrong/incomplete settled facts %#', async (override) => {
    const transport = http({ ...kakaoPayment, ...override });
    expect(
      await createKakaoRenewalAdapter(env(), transport).charge(charge),
    ).toEqual(unknown);
    expect(transport).toHaveBeenCalledOnce();
  });
  it.each([
    ['2026-11-24T09:00:00', '2026-11-24T00:00:00.000Z'],
    ['2026-11-24T09:00:00.123', '2026-11-24T00:00:00.123Z'],
    ['2026-11-24T09:00:00+09:00', '2026-11-24T00:00:00.000Z'],
    ['2026-11-24T09:00:00Z', '2026-11-24T09:00:00.000Z'],
    ['2026-11-24T09:00:00-04:00', '2026-11-24T13:00:00.000Z'],
  ])('normalizes explicit provider datetime %s', async (approved, expected) => {
    expect(
      await createKakaoRenewalAdapter(
        env(),
        http({ ...kakaoPayment, approved_at: approved }),
      ).charge(charge),
    ).toEqual({ ok: true, data: { ...expectedKakao, approvedAt: expected } });
  });
  it.each([undefined, '6527', '8008', 'UNKNOWN_SOURCE_REASON'])(
    'classifies -782 source %s as definitive but never assumes safe unattended retry',
    async (sourceReason) => {
      const transport = http(
        {
          error_code: -782,
          error_message: 'fictional-private-provider-text',
          extras: { method_result_code: sourceReason },
        },
        400,
      );
      expect(
        await createKakaoRenewalAdapter(env(), transport).charge(charge),
      ).toEqual({
        ok: false,
        code: 'PROVIDER_REJECTED',
        outcome: 'rejected',
        retryAllowed: false,
        failureDisposition: 'customer_action',
      });
      expect(transport).toHaveBeenCalledOnce();
    },
  );
  it.each([-1, -701, -702, -783, 0, '782'])(
    'does not reuse enrollment or undocumented error %s as a renewal decline',
    async (code) => {
      expect(
        await createKakaoRenewalAdapter(
          env(),
          http({ error_code: code }, 400),
        ).charge(charge),
      ).toEqual(unknown);
    },
  );
  it('lost TID stays held without calling SID status, order or a new charge', async () => {
    const transport = http({ available: true, last_approved_at: 'now' });
    expect(
      await createKakaoRenewalAdapter(env(), transport).query(identity),
    ).toEqual(unknown);
    expect(transport).not.toHaveBeenCalled();
  });
  it('known TID queries its immutable order and records exactly matching action evidence', async () => {
    const transport = http(kakaoOrder);
    expect(
      await createKakaoRenewalAdapter(env(), transport).query({
        ...identity,
        providerPaymentId: kakaoPayment.tid,
      }),
    ).toEqual({ ok: true, data: expectedKakao });
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]![0]).toBe(KAKAOPAY_ORDER_URL);
    expect(JSON.parse(transport.mock.calls[0]![1].body as string)).toEqual({
      cid: fixture.KAKAOPAY_RECURRING_CID,
      tid: kakaoPayment.tid,
    });
  });
  it.each([
    { status: 'ISSUED_SID' },
    { tid: 'different-tid' },
    { partner_order_id: identity.customerRef },
    { partner_user_id: identity.orderId },
    { canceled_amount: { total: 1 } },
    { payment_action_details: [] },
    {
      payment_action_details: [
        ...kakaoOrder.payment_action_details,
        ...kakaoOrder.payment_action_details,
      ],
    },
    {
      payment_action_details: [
        {
          ...kakaoOrder.payment_action_details[0],
          payment_action_type: 'ISSUED_SID',
        },
      ],
    },
    {
      payment_action_details: [
        { ...kakaoOrder.payment_action_details[0], amount: 1 },
      ],
    },
    {
      payment_action_details: [
        {
          ...kakaoOrder.payment_action_details[0],
          approved_at: '2026-11-25T09:00:00',
        },
      ],
    },
  ])('cannot recover a mismatching known-TID order %#', async (override) => {
    expect(
      await createKakaoRenewalAdapter(
        env(),
        http({ ...kakaoOrder, ...override }),
      ).query({ ...identity, providerPaymentId: kakaoPayment.tid }),
    ).toEqual(unknown);
  });
  it.each([400, 404, 408, 409, 429, 500])(
    'leaves known-TID query failure HTTP %s held even with -782',
    async (status) => {
      expect(
        await createKakaoRenewalAdapter(
          env(),
          http({ error_code: -782 }, status),
        ).query({ ...identity, providerPaymentId: kakaoPayment.tid }),
      ).toEqual(unknown);
    },
  );
});

describe.each([
  [
    'Toss',
    createTossRenewalAdapter,
    tossPayment,
    { code: 'REJECT_CARD_PAYMENT' },
  ],
  ['Kakao', createKakaoRenewalAdapter, kakaoPayment, { error_code: -782 }],
] as const)(
  '%s renewal transport boundaries',
  (_name, create, payment, refusal) => {
    it.each([
      { customerRef: 'human-user' },
      { orderId: 'human-order' },
      { amountKrw: 0 },
      { amountKrw: -1 },
      { amountKrw: 1.5 },
      { amountKrw: 2147483648 },
      { credential: '' },
      { credential: 'contains\ncontrol' },
      { credential: 'a'.repeat(201) },
      { idempotencyKey: 'unpersisted' },
      { email: 'private-detail' },
    ])(
      'rejects invalid or unexpected charge fields before transport %#',
      async (override) => {
        const transport = http(payment);
        expect(
          await create(env(), transport).charge({ ...charge, ...override }),
        ).toEqual(invalid);
        expect(transport).not.toHaveBeenCalled();
      },
    );
    it.each([
      { orderId: 'not-uuid' },
      { amountKrw: 0 },
      { providerPaymentId: '' },
      { providerPaymentId: 'unsafe/value' },
      { credential: 'do-not-query-with-credential' },
    ])('rejects invalid query fields before transport %#', async (override) => {
      const transport = http(payment);
      expect(
        await create(env(), transport).query({ ...identity, ...override }),
      ).toEqual(invalid);
      expect(transport).not.toHaveBeenCalled();
    });
    it('disabled integration cannot dispatch', async () => {
      const transport = http(payment);
      expect(
        await create(env({ PAYMENTS_MODE: 'disabled' }), transport).charge(
          charge,
        ),
      ).toMatchObject({ ok: false, outcome: 'not_started' });
      expect(transport).not.toHaveBeenCalled();
    });
    it.each([408, 409, 425, 429, 500, 503])(
      'ambiguous status %s never becomes a definite decline',
      async (status) => {
        const transport = http(refusal, status);
        expect(await create(env(), transport).charge(charge)).toEqual(unknown);
        expect(transport).toHaveBeenCalledOnce();
      },
    );
    it('transport exceptions cannot escape secret-bearing URLs or become failure/retry', async () => {
      const transport = vi
        .fn<EnrollmentTransport>()
        .mockRejectedValue(
          new Error(
            'SECRET_KEY fictional-secret /v1/billing/private-credential',
          ),
        );
      expect(await create(env(), transport).charge(charge)).toEqual(unknown);
      expect(transport).toHaveBeenCalledOnce();
    });
    it('bounds the charge to 65 seconds and aborts instead of re-dispatching', async () => {
      vi.useFakeTimers();
      const transport = vi.fn<EnrollmentTransport>(() => new Promise(() => {}));
      const pending = create(env(), transport).charge(charge);
      let finished = false;
      void pending.then(() => {
        finished = true;
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(finished).toBe(false);
      await vi.advanceTimersByTimeAsync(ENROLLMENT_CHARGE_TIMEOUT_MS - 60_000);
      expect(await pending).toEqual(unknown);
      expect(transport).toHaveBeenCalledOnce();
      expect(transport.mock.calls[0]![1].signal?.aborted).toBe(true);
    });
    it('uses the same finite deadline for a stalled response body', async () => {
      vi.useFakeTimers();
      const cancel = vi.fn();
      const transport = vi.fn<EnrollmentTransport>(
        async () =>
          new Response(new ReadableStream({ cancel }), {
            headers: { 'Content-Type': 'application/json' },
          }),
      );
      const pending = create(env(), transport).charge(charge);
      await vi.advanceTimersByTimeAsync(ENROLLMENT_CHARGE_TIMEOUT_MS);
      expect(await pending).toEqual(unknown);
      expect(cancel).toHaveBeenCalledOnce();
      expect(transport).toHaveBeenCalledOnce();
    });
    it('query has its separate finite non-mutating budget', async () => {
      vi.useFakeTimers();
      const transport = vi.fn<EnrollmentTransport>(() => new Promise(() => {}));
      const pending = create(env(), transport).query({
        ...identity,
        providerPaymentId: 'fictional-known-payment',
      });
      await vi.advanceTimersByTimeAsync(ENROLLMENT_QUERY_TIMEOUT_MS);
      expect(await pending).toEqual(unknown);
      expect(transport).toHaveBeenCalledOnce();
      expect(transport.mock.calls[0]![1].signal?.aborted).toBe(true);
    });
    it.each(['html', 'malformed', 'oversized'] as const)(
      'holds %s provider responses',
      async (kind) => {
        const transport = vi.fn<EnrollmentTransport>(async () =>
          kind === 'html'
            ? new Response('<html>secret</html>', {
                headers: { 'Content-Type': 'text/html' },
              })
            : kind === 'malformed'
              ? new Response('{bad', {
                  headers: { 'Content-Type': 'application/json' },
                })
              : json({
                  ...payment,
                  untrusted: 'x'.repeat(PAYMENT_RESPONSE_MAX_BYTES),
                }),
        );
        expect(await create(env(), transport).charge(charge)).toEqual(unknown);
        expect(transport).toHaveBeenCalledOnce();
      },
    );
  },
);
