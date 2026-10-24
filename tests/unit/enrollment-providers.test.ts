// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseServerEnv, type ServerEnv } from '@/config/env.server';
import {
  ENROLLMENT_CHARGE_TIMEOUT_MS,
  ENROLLMENT_QUERY_TIMEOUT_MS,
  KAKAOPAY_APPROVE_URL,
  KAKAOPAY_ORDER_URL,
  TOSS_API_ORIGIN,
  TOSS_ISSUE_PATH,
} from '@/config/enrollment-provider';
import {
  KAKAOPAY_READY_URL,
  PAYMENT_RESPONSE_MAX_BYTES,
} from '@/config/payment-preparation';
import { createTossEnrollmentAdapter } from '@/server/adapters/payment/enrollment-toss';
import { createKakaoEnrollmentAdapter } from '@/server/adapters/payment/enrollment-kakaopay';
import type { EnrollmentTransport } from '@/server/adapters/payment/enrollment';

const identity = {
  sessionId: 'a1500000-0000-4000-8000-000000000001',
  customerRef: 'a1500000-0000-4000-8000-000000000002',
  orderId: 'a1500000-0000-4000-8000-000000000003',
  callbackState: 'a'.repeat(43),
  amountKrw: 1000,
};
const paymentIdentity = {
  customerRef: identity.customerRef,
  orderId: identity.orderId,
  amountKrw: identity.amountKrw,
};
const idempotencyKey = 'a1500000-0000-4000-8000-000000000004';
const issue = {
  customerRef: identity.customerRef,
  authKey: 'fictional-once-auth-key',
  idempotencyKey,
};
const charge = {
  ...paymentIdentity,
  credential: 'fictional-billing-key',
  idempotencyKey,
};
const tid = 'T1234567890123456789';
const query = { ...paymentIdentity, tid };
const approve = { ...query, pgToken: 'fictional-once-pg-token' };
const fixtureEnv = {
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
  const parsed = parseServerEnv({ ...fixtureEnv, ...overrides });
  if (!parsed.ok) throw new Error('Invalid fixture');
  return parsed.data;
}
const issuedBody = {
  mId: fixtureEnv.TOSS_BILLING_MID,
  customerKey: identity.customerRef,
  billingKey: charge.credential,
  method: '카드',
  authenticatedAt: '2026-10-24T09:00:00+09:00',
  card: { number: 'fictional-unretained-private-field' },
};
const tossPayment = {
  mId: fixtureEnv.TOSS_BILLING_MID,
  type: 'BILLING',
  orderId: identity.orderId,
  status: 'DONE',
  method: '카드',
  currency: 'KRW',
  totalAmount: identity.amountKrw,
  balanceAmount: identity.amountKrw,
  taxFreeAmount: 0,
  taxExemptionAmount: 0,
  approvedAt: '2026-10-24T09:00:01+09:00',
  paymentKey: 'fictional-payment-key',
  lastTransactionKey: 'fictional-transaction-key',
  card: { number: 'fictional-unretained-private-field' },
};
const readyBody = {
  tid,
  next_redirect_mobile_url:
    'https://mockup-pg-web.kakao.com/v1/fictional/mInfo',
  next_redirect_pc_url: 'https://mockup-pg-web.kakao.com/v1/fictional/info',
};
const kakaoPayment = {
  cid: fixtureEnv.KAKAOPAY_RECURRING_CID,
  tid,
  aid: 'fictional-action-id',
  sid: 'fictional-subscription-id',
  partner_order_id: identity.orderId,
  partner_user_id: identity.customerRef,
  payment_method_type: 'MONEY',
  amount: { total: identity.amountKrw, tax_free: 0, vat: 91 },
  approved_at: '2026-10-24T09:00:01',
  card_info: { number: 'fictional-unretained-private-field' },
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
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
  });
}
function transport(value: unknown, status = 200) {
  return vi
    .fn<EnrollmentTransport>()
    .mockImplementation(async () => json(value, status));
}
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
const rejected = {
  ok: false,
  code: 'PROVIDER_REJECTED',
  outcome: 'rejected',
  retryAllowed: false,
};
const expectedTossCharge = {
  ...paymentIdentity,
  providerPaymentId: tossPayment.paymentKey,
  providerTransactionId: tossPayment.lastTransactionKey,
  approvedAt: '2026-10-24T00:00:01.000Z',
  currency: 'KRW',
  merchantAccount: fixtureEnv.TOSS_BILLING_MID,
};
const expectedKakaoCharge = {
  ...paymentIdentity,
  providerPaymentId: tid,
  providerTransactionId: kakaoPayment.aid,
  approvedAt: '2026-10-24T00:00:01.000Z',
  currency: 'KRW',
  merchantAccount: fixtureEnv.KAKAOPAY_RECURRING_CID,
};
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('No provider network allowed');
    }),
  );
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('real Toss billing protocol with injected offline transport', () => {
  it('exchanges only SDK authKey/customerKey using Basic auth and persisted operation UUID', async () => {
    const http = transport(issuedBody);
    const result = await createTossEnrollmentAdapter(env(), http).exchange(
      issue,
    );
    expect(result).toEqual({
      ok: true,
      data: {
        credential: charge.credential,
        customerRef: identity.customerRef,
        merchantAccount: fixtureEnv.TOSS_BILLING_MID,
      },
    });
    expect(http).toHaveBeenCalledOnce();
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe(`${TOSS_API_ORIGIN}${TOSS_ISSUE_PATH}`);
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        Authorization: `Basic ${Buffer.from(`${fixtureEnv.TOSS_SECRET_KEY}:`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
    });
    expect(JSON.parse(init.body as string)).toEqual({
      customerKey: identity.customerRef,
      authKey: issue.authKey,
    });
    expect(JSON.stringify(result)).not.toContain(
      'fictional-unretained-private-field',
    );
    expect(JSON.stringify(result)).not.toContain(issue.authKey);
  });
  it('charges the exact amount once using a path-encoded stored credential and stable idempotency key', async () => {
    const http = transport(tossPayment);
    const result = await createTossEnrollmentAdapter(env(), http).charge({
      ...charge,
      credential: 'key/with?reserved=#',
    });
    expect(result).toEqual({ ok: true, data: expectedTossCharge });
    expect(http).toHaveBeenCalledOnce();
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe(
      `${TOSS_API_ORIGIN}/v1/billing/key%2Fwith%3Freserved%3D%23`,
    );
    expect(new URL(url).search).toBe('');
    expect(JSON.parse(init.body as string)).toEqual({
      customerKey: identity.customerRef,
      amount: 1000,
      orderId: identity.orderId,
      orderName: expect.any(String),
      taxFreeAmount: 0,
    });
    expect(init.headers).toMatchObject({ 'Idempotency-Key': idempotencyKey });
    expect(Object.keys(result.ok ? result.data : {})).not.toContain(
      'credential',
    );
    expect(Object.keys(result.ok ? result.data : {})).not.toContain(
      'idempotencyKey',
    );
  });
  it('queries only by immutable orderId, never confirms again or requires invented Payment.customerKey', async () => {
    const http = transport(tossPayment);
    expect(
      await createTossEnrollmentAdapter(env(), http).query(paymentIdentity),
    ).toEqual({ ok: true, data: expectedTossCharge });
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe(
      `${TOSS_API_ORIGIN}/v1/payments/orders/${identity.orderId}`,
    );
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers).not.toHaveProperty('Idempotency-Key');
  });
  it('preserves the caller supplied operation key across a separately authorized replay', async () => {
    const http = transport(tossPayment);
    const adapter = createTossEnrollmentAdapter(env(), http);
    await adapter.charge(charge);
    await adapter.charge(charge);
    expect(http).toHaveBeenCalledTimes(2);
    expect(http.mock.calls[0]![1].headers).toEqual(
      http.mock.calls[1]![1].headers,
    );
    expect(http.mock.calls[0]![1].body).toEqual(http.mock.calls[1]![1].body);
  });
  it.each([
    { mId: 'different-mid' },
    { customerKey: identity.orderId },
    { billingKey: '' },
    { method: '계좌이체' },
    { authenticatedAt: '2026-10-24T09:00:00' },
  ])('holds malformed/misbound issuance as unknown %#', async (override) => {
    const http = transport({ ...issuedBody, ...override });
    expect(
      await createTossEnrollmentAdapter(env(), http).exchange(issue),
    ).toEqual(unknown);
    expect(http).toHaveBeenCalledOnce();
  });
  it.each([
    { mId: 'different-mid' },
    { orderId: identity.sessionId },
    { type: 'NORMAL' },
    { status: 'CANCELED' },
    { status: 'PARTIAL_CANCELED' },
    { status: 'IN_PROGRESS' },
    { currency: 'USD' },
    { totalAmount: 999 },
    { totalAmount: 1000.5 },
    { balanceAmount: 999 },
    { taxFreeAmount: 1 },
    { taxFreeAmount: null },
    { taxFreeAmount: undefined },
    { taxExemptionAmount: 1 },
    { taxExemptionAmount: null },
    { taxExemptionAmount: undefined },
    { method: '간편결제' },
    { approvedAt: null },
    { lastTransactionKey: null },
    { paymentKey: '' },
    { approvedAt: 'not-a-time' },
  ])(
    'cannot settle mismatching or incomplete payment evidence %#',
    async (override) => {
      expect(
        await createTossEnrollmentAdapter(
          env(),
          transport({ ...tossPayment, ...override }),
        ).charge(charge),
      ).toEqual(unknown);
      expect(
        await createTossEnrollmentAdapter(
          env(),
          transport({ ...tossPayment, ...override }),
        ).query(paymentIdentity),
      ).toEqual(unknown);
    },
  );
  it.each([
    { customerRef: 'guessable-user' },
    { orderId: 'human-order' },
    { amountKrw: 0 },
    { amountKrw: -1 },
    { amountKrw: 1.5 },
    { amountKrw: 2147483648 },
    { credential: '' },
    { idempotencyKey: 'unpersisted' },
    { email: 'fictional-private' },
  ])(
    'rejects invalid or extra charge input before I/O %#',
    async (override) => {
      const http = transport(tossPayment);
      expect(
        await createTossEnrollmentAdapter(env(), http).charge({
          ...charge,
          ...override,
        }),
      ).toEqual(invalid);
      expect(http).not.toHaveBeenCalled();
    },
  );
  it.each([
    { authKey: '' },
    { authKey: 'a'.repeat(301) },
    { authKey: 'bad\nheader' },
    { idempotencyKey: 'bad' },
    { customerRef: 'not-uuid' },
    { extra: 'private' },
  ])('rejects invalid exchange input before I/O %#', async (override) => {
    const http = transport(issuedBody);
    expect(
      await createTossEnrollmentAdapter(env(), http).exchange({
        ...issue,
        ...override,
      }),
    ).toEqual(invalid);
    expect(http).not.toHaveBeenCalled();
  });
  it('waits beyond 60 seconds before classifying a hung charge as unknown, with one dispatch', async () => {
    vi.useFakeTimers();
    const http = vi
      .fn<EnrollmentTransport>()
      .mockImplementation(() => new Promise(() => {}));
    const pending = createTossEnrollmentAdapter(env(), http).charge(charge);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(ENROLLMENT_CHARGE_TIMEOUT_MS - 60_000);
    expect(await pending).toEqual(unknown);
    expect(http).toHaveBeenCalledOnce();
    expect(http.mock.calls[0]![1].signal?.aborted).toBe(true);
  });
  it.each(['INVALID_REJECT_CARD', 'REJECT_CARD_PAYMENT', 'KYC_BLOCKED'])(
    'recognizes documented definitive rejection %s but never retries it',
    async (code) => {
      const http = transport(
        { code, message: 'fictional-secret-provider-text' },
        403,
      );
      expect(
        await createTossEnrollmentAdapter(env(), http).charge(charge),
      ).toEqual(rejected);
      expect(http).toHaveBeenCalledOnce();
    },
  );
  it.each([
    'ALREADY_PROCESSED_PAYMENT',
    'IDEMPOTENT_REQUEST_PROCESSING',
    'PROVIDER_ERROR',
    'UNKNOWN_PAYMENT_ERROR',
    'UNRECOGNIZED_NEW_CODE',
  ])('keeps ambiguous/duplicate code %s unknown', async (code) => {
    expect(
      await createTossEnrollmentAdapter(env(), transport({ code }, 400)).charge(
        charge,
      ),
    ).toEqual(unknown);
  });
  it('does not infer an absent historical charge from query 404', async () => {
    expect(
      await createTossEnrollmentAdapter(
        env(),
        transport({ code: 'NOT_FOUND_PAYMENT' }, 404),
      ).query(paymentIdentity),
    ).toEqual(unknown);
  });
});

describe('direct KakaoPay charged enrollment protocol with injected offline transport', () => {
  it('ready uses the first-charge amount and canonical callbacks, not zero registration or invented idempotency', async () => {
    const http = transport(readyBody);
    expect(
      await createKakaoEnrollmentAdapter(env(), http).ready(identity),
    ).toEqual({
      ok: true,
      data: {
        tid,
        redirects: {
          mobile: readyBody.next_redirect_mobile_url,
          desktop: readyBody.next_redirect_pc_url,
        },
      },
    });
    expect(http).toHaveBeenCalledOnce();
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe(KAKAOPAY_READY_URL);
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
    expect(init.headers).toEqual({
      Authorization: `SECRET_KEY ${fixtureEnv.KAKAOPAY_SECRET_KEY}`,
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      cid: 'TCSUBSCRIP',
      partner_order_id: identity.orderId,
      partner_user_id: identity.customerRef,
      total_amount: 1000,
      tax_free_amount: 0,
      quantity: 1,
    });
    expect(body).not.toHaveProperty('vat_amount');
    for (const [field, outcome] of [
      ['approval_url', 'success'],
      ['cancel_url', 'cancel'],
      ['fail_url', 'failure'],
    ]) {
      const callback = new URL(body[field!]);
      expect(callback.origin).toBe(fixtureEnv.NEXT_PUBLIC_APP_URL);
      expect(Object.fromEntries(callback.searchParams)).toEqual({
        session: identity.sessionId,
        state: identity.callbackState,
        outcome,
      });
    }
  });
  it('approve settles first charge and returns SID, never dispatches an additional subscription charge', async () => {
    const http = transport(kakaoPayment);
    const result = await createKakaoEnrollmentAdapter(
      env({ KAKAOPAY_CID_SECRET: 'fictional-issued-cid-secret' }),
      http,
    ).approve(approve);
    expect(result).toEqual({
      ok: true,
      data: { credential: kakaoPayment.sid, charge: expectedKakaoCharge },
    });
    expect(http).toHaveBeenCalledOnce();
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe(KAKAOPAY_APPROVE_URL);
    expect(JSON.parse(init.body as string)).toEqual({
      cid: 'TCSUBSCRIP',
      cid_secret: 'fictional-issued-cid-secret',
      tid,
      partner_order_id: identity.orderId,
      partner_user_id: identity.customerRef,
      pg_token: approve.pgToken,
      total_amount: 1000,
    });
    expect(init.headers).not.toHaveProperty('Idempotency-Key');
    expect(JSON.stringify(result)).not.toContain(approve.pgToken);
    expect(JSON.stringify(result)).not.toContain(
      'fictional-unretained-private-field',
    );
  });
  it('known-TID query verifies PAYMENT action but cannot invent recovery of SID', async () => {
    const http = transport(kakaoOrder);
    const result = await createKakaoEnrollmentAdapter(env(), http).query(query);
    expect(result).toEqual({ ok: true, data: expectedKakaoCharge });
    expect(http).toHaveBeenCalledOnce();
    expect(http.mock.calls[0]![0]).toBe(KAKAOPAY_ORDER_URL);
    expect(JSON.parse(http.mock.calls[0]![1].body as string)).toEqual({
      cid: 'TCSUBSCRIP',
      tid,
    });
    expect(result.ok && Object.keys(result.data)).not.toContain('credential');
    expect(JSON.stringify(result)).not.toContain(kakaoPayment.sid);
  });
  it.each([
    '2026-10-24T09:00:01',
    '2026-10-24T09:00:01+09:00',
    '2026-10-24T00:00:01Z',
  ])(
    'normalizes %s explicitly without host timezone dependence',
    async (approved_at) => {
      expect(
        await createKakaoEnrollmentAdapter(
          env(),
          transport({ ...kakaoPayment, approved_at }),
        ).approve(approve),
      ).toEqual({
        ok: true,
        data: { credential: kakaoPayment.sid, charge: expectedKakaoCharge },
      });
    },
  );
  it.each([
    { cid: 'OTHER' },
    { tid: 'different' },
    { partner_order_id: identity.sessionId },
    { partner_user_id: identity.sessionId },
    { payment_method_type: 'MOBILE' },
    { amount: { total: 999, tax_free: 0 } },
    { amount: { total: 1000, tax_free: 1 } },
    { sid: '' },
    { sid: undefined },
    { aid: '' },
    { approved_at: '2026-02-30T10:00:00' },
  ])('holds mismatched/incomplete approval as unknown %#', async (override) => {
    expect(
      await createKakaoEnrollmentAdapter(
        env(),
        transport({ ...kakaoPayment, ...override }),
      ).approve(approve),
    ).toEqual(unknown);
  });
  it.each([
    { status: 'ISSUED_SID' },
    { status: 'READY' },
    { status: 'CANCEL_PAYMENT' },
    { status: 'PART_CANCEL_PAYMENT' },
    { canceled_amount: { total: 1 } },
    { payment_action_details: [] },
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
        { ...kakaoOrder.payment_action_details[0], amount: 999 },
      ],
    },
    {
      payment_action_details: [
        {
          ...kakaoOrder.payment_action_details[0],
          approved_at: '2026-10-23T09:00:01',
        },
      ],
    },
    {
      payment_action_details: [
        ...kakaoOrder.payment_action_details,
        ...kakaoOrder.payment_action_details,
      ],
    },
    {
      payment_action_details: [
        ...kakaoOrder.payment_action_details,
        {
          ...kakaoOrder.payment_action_details[0],
          payment_action_type: 'CANCEL',
        },
      ],
    },
    { partner_order_id: identity.sessionId },
    { partner_user_id: identity.sessionId },
    { tid: 'different' },
    { cid: 'OTHER' },
  ])(
    'query cannot settle SID-only, canceled, duplicated or misbound evidence %#',
    async (override) => {
      expect(
        await createKakaoEnrollmentAdapter(
          env(),
          transport({ ...kakaoOrder, ...override }),
        ).query(query),
      ).toEqual(unknown);
    },
  );
  it.each([
    'http://online-pay.kakao.com/path',
    'https://online-pay.kakao.com.evil.test/path',
    'https://online-pay.kakao.com:444/path',
    'https://private@online-pay.kakao.com/path',
    'https://online-pay.kakao.com/path#secret',
    'javascript:alert(1)',
  ])(
    'rejects unsafe ready redirect %s without exposing provider text',
    async (url) => {
      expect(
        await createKakaoEnrollmentAdapter(
          env(),
          transport({ ...readyBody, next_redirect_mobile_url: url }),
        ).ready(identity),
      ).toEqual(unknown);
    },
  );
  it('accepts configured live origins but rejects sandbox-only redirect in live mode', async () => {
    const live = env({
      PAYMENTS_MODE: 'live',
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'live_ck_fictional',
      TOSS_SECRET_KEY: 'live_sk_fictional',
      KAKAOPAY_RECURRING_CID: 'FICTIONAL_LIVE_CID',
    });
    expect(
      await createKakaoEnrollmentAdapter(live, transport(readyBody)).ready(
        identity,
      ),
    ).toEqual(unknown);
    const body = {
      tid,
      next_redirect_mobile_url: 'https://online-pay.kakao.com/fictional',
      next_redirect_pc_url: 'https://online-payment.kakaopay.com/fictional',
    };
    expect(
      (
        await createKakaoEnrollmentAdapter(live, transport(body)).ready(
          identity,
        )
      ).ok,
    ).toBe(true);
  });
  it.each([
    { amountKrw: 0 },
    { amountKrw: -1 },
    { amountKrw: 1.5 },
    { sessionId: 'bad' },
    { callbackState: 'short' },
    { customerRef: 'guessed-user' },
    { taxFreeAmount: 10 },
  ])('invalid/extra ready input fails before dispatch %#', async (override) => {
    const http = transport(readyBody);
    expect(
      await createKakaoEnrollmentAdapter(env(), http).ready({
        ...identity,
        ...override,
      }),
    ).toEqual(invalid);
    expect(http).not.toHaveBeenCalled();
  });
  it.each([
    { tid: '' },
    { pgToken: '' },
    { pgToken: 'a'.repeat(301) },
    { amountKrw: 0 },
    { customerRef: 'bad' },
    { orderId: 'human-order' },
    { customerName: 'fictional' },
  ])(
    'invalid/extra approve input fails before dispatch %#',
    async (override) => {
      const http = transport(kakaoPayment);
      expect(
        await createKakaoEnrollmentAdapter(env(), http).approve({
          ...approve,
          ...override,
        }),
      ).toEqual(invalid);
      expect(http).not.toHaveBeenCalled();
    },
  );
  it('classifies authentication-incomplete refusal but keeps already-paid or undocumented errors unknown', async () => {
    expect(
      await createKakaoEnrollmentAdapter(
        env(),
        transport({ error_code: -701 }, 400),
      ).approve(approve),
    ).toEqual(rejected);
    expect(
      await createKakaoEnrollmentAdapter(
        env(),
        transport({ error_code: -702 }, 400),
      ).approve(approve),
    ).toEqual(unknown);
    expect(
      await createKakaoEnrollmentAdapter(
        env(),
        transport({ error_code: -9999 }, 400),
      ).approve(approve),
    ).toEqual(unknown);
  });
  it('query 404 or provider refusal cannot authorize another approval', async () => {
    expect(
      await createKakaoEnrollmentAdapter(
        env(),
        transport({ error_code: -701 }, 404),
      ).query(query),
    ).toEqual(unknown);
  });
});

describe('bounded provider HTTP safety across every method', () => {
  const methods = [
    {
      name: 'Toss exchange',
      run: (e: ServerEnv, http: EnrollmentTransport) =>
        createTossEnrollmentAdapter(e, http).exchange(issue),
    },
    {
      name: 'Toss charge',
      run: (e: ServerEnv, http: EnrollmentTransport) =>
        createTossEnrollmentAdapter(e, http).charge(charge),
    },
    {
      name: 'Toss query',
      run: (e: ServerEnv, http: EnrollmentTransport) =>
        createTossEnrollmentAdapter(e, http).query(paymentIdentity),
    },
    {
      name: 'Kakao ready',
      run: (e: ServerEnv, http: EnrollmentTransport) =>
        createKakaoEnrollmentAdapter(e, http).ready(identity),
    },
    {
      name: 'Kakao approve',
      run: (e: ServerEnv, http: EnrollmentTransport) =>
        createKakaoEnrollmentAdapter(e, http).approve(approve),
    },
    {
      name: 'Kakao query',
      run: (e: ServerEnv, http: EnrollmentTransport) =>
        createKakaoEnrollmentAdapter(e, http).query(query),
    },
  ];
  it.each(methods)(
    '$name never dispatches disabled configuration',
    async ({ run }) => {
      const http = transport({});
      expect(await run(env({ PAYMENTS_MODE: 'disabled' }), http)).toMatchObject(
        { ok: false, code: 'INTEGRATION_UNAVAILABLE', outcome: 'not_started' },
      );
      expect(http).not.toHaveBeenCalled();
    },
  );
  it.each(methods)(
    '$name never dispatches forged mode/key configuration',
    async ({ run }) => {
      const http = transport({});
      expect(
        await run({ ...env(), TOSS_SECRET_KEY: 'live_sk_fictional' }, http),
      ).toMatchObject({
        ok: false,
        code: 'CONFIGURATION_INVALID',
        outcome: 'not_started',
      });
      expect(http).not.toHaveBeenCalled();
    },
  );
  it.each(methods)(
    '$name sanitizes transport errors and dispatches only once',
    async ({ run }) => {
      const http = vi
        .fn<EnrollmentTransport>()
        .mockRejectedValue(new Error('fictional-private-token-or-header'));
      expect(await run(env(), http)).toEqual(unknown);
      expect(http).toHaveBeenCalledOnce();
    },
  );
  it.each(methods)(
    '$name bounds oversized/malformed/non-JSON response bodies',
    async ({ run }) => {
      for (const response of [
        new Response('not JSON', {
          headers: { 'Content-Type': 'application/json' },
        }),
        new Response('{}', { headers: { 'Content-Type': 'text/html' } }),
        json({ extra: 'x'.repeat(PAYMENT_RESPONSE_MAX_BYTES + 1) }),
        new Response(new Uint8Array([0xc3, 0x28]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ]) {
        const http = vi.fn<EnrollmentTransport>().mockResolvedValue(response);
        expect(await run(env(), http)).toEqual(unknown);
        expect(http).toHaveBeenCalledOnce();
      }
    },
  );
  it.each([408, 409, 425, 429, 500, 502, 503])(
    'HTTP %s remains unknown even with a known rejection body',
    async (status) => {
      expect(
        await createTossEnrollmentAdapter(
          env(),
          transport({ code: 'REJECT_CARD_PAYMENT' }, status),
        ).charge(charge),
      ).toEqual(unknown);
      expect(
        await createKakaoEnrollmentAdapter(
          env(),
          transport({ error_code: -701 }, status),
        ).approve(approve),
      ).toEqual(unknown);
    },
  );
  it('bounds a response body that stalls after headers and closes the reader on timeout', async () => {
    vi.useFakeTimers();
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true;
      },
    });
    const http = vi
      .fn<EnrollmentTransport>()
      .mockResolvedValue(
        new Response(body, { headers: { 'Content-Type': 'application/json' } }),
      );
    const pending = createKakaoEnrollmentAdapter(env(), http).query(query);
    await vi.advanceTimersByTimeAsync(ENROLLMENT_QUERY_TIMEOUT_MS);
    expect(await pending).toEqual(unknown);
    expect(http).toHaveBeenCalledOnce();
    expect(canceled).toBe(true);
  });
});
