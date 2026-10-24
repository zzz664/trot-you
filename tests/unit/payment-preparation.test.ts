// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseServerEnv, type ServerEnv } from '@/config/env.server';
import {
  KAKAOPAY_READY_URL,
  PAYMENT_PREPARATION_TIMEOUT_MS,
  PAYMENT_RESPONSE_MAX_BYTES,
  TOSS_BILLING_SDK_URL,
} from '@/config/payment-preparation';
import { routes } from '@/config/routes';
import {
  createKakaoPayPreparationAdapter,
  type PaymentPreparationTransport,
} from '@/server/adapters/payment/kakaopay';
import {
  preparationCallbacks,
  type PreparationIdentity,
} from '@/server/adapters/payment/preparation';
import { prepareTossBillingAuth } from '@/server/adapters/payment/toss';

const identity: PreparationIdentity = {
  sessionId: 'a1300000-0000-4000-8000-000000000001',
  customerRef: 'a1300000-0000-4000-8000-000000000002',
  orderId: 'a1300000-0000-4000-8000-000000000003',
  callbackState: 'a'.repeat(43),
};
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
  if (!parsed.ok) throw new Error('Invalid test fixture');
  return parsed.data;
}
const body = {
  tid: 'T1234567890123456789',
  next_redirect_mobile_url:
    'https://mockup-pg-web.kakao.com/v1/fictional/mInfo',
  next_redirect_pc_url: 'https://mockup-pg-web.kakao.com/v1/fictional/info',
  next_redirect_app_url: 'https://mockup-pg-web.kakao.com/v1/fictional/aInfo',
  created_at: '2026-10-24T00:00:00',
};
function json(value: unknown = body, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
  });
}
function transport(response = json()) {
  return vi.fn<PaymentPreparationTransport>().mockResolvedValue(response);
}
beforeEach(() => {
  // Every test owns an injected fake HTTP transport. Any accidental default
  // transport invocation fails locally, rather than reaching a provider.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Provider network is forbidden in unit tests');
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Toss hosted CARD registration protocol descriptor', () => {
  it('projects only the real SDK method and client-safe required fields', () => {
    const result = prepareTossBillingAuth(env(), identity);
    expect(result).toEqual({
      ok: true,
      data: {
        kind: 'toss_billing_auth',
        sdkUrl: TOSS_BILLING_SDK_URL,
        clientKey: 'test_ck_fictional',
        payment: { customerKey: identity.customerRef },
        requestBillingAuth: {
          method: 'CARD',
          successUrl: expect.any(String),
          failUrl: expect.any(String),
        },
        launchAvailable: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain(fixture.TOSS_SECRET_KEY);
    expect(JSON.stringify(result)).not.toContain(fixture.TOSS_BILLING_MID);
    expect(JSON.stringify(result)).not.toContain(fixture.KAKAOPAY_SECRET_KEY);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps callback origin/path fixed and carries only opaque correlation', () => {
    const result = prepareTossBillingAuth(env(), identity);
    if (!result.ok) throw new Error('Expected descriptor');
    for (const [field, outcome] of [
      ['successUrl', 'success'],
      ['failUrl', 'failure'],
    ] as const) {
      const url = new URL(result.data.requestBillingAuth[field]);
      expect(url.origin).toBe(fixture.NEXT_PUBLIC_APP_URL);
      expect(url.pathname).toBe(routes.checkoutReturn);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        session: identity.sessionId,
        state: identity.callbackState,
        outcome,
      });
      expect(url.hash).toBe('');
    }
  });
  it.each([
    { PAYMENTS_MODE: 'disabled' },
    { TOSS_BILLING_ENABLED: 'false' },
    { TOSS_SECRET_KEY: '' },
    { NEXT_PUBLIC_TOSS_CLIENT_KEY: '' },
    { TOSS_BILLING_MID: '' },
  ])('fails closed for missing/disabled configuration %j', (overrides) => {
    expect(prepareTossBillingAuth(env(overrides), identity)).toEqual({
      ok: false,
      code: 'INTEGRATION_UNAVAILABLE',
      outcome: 'not_started',
      retryAllowed: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects a forged incompatible runtime configuration', () => {
    const invalid = { ...env(), TOSS_SECRET_KEY: 'live_sk_fictional' };
    expect(prepareTossBillingAuth(invalid, identity)).toMatchObject({
      ok: false,
      code: 'CONFIGURATION_INVALID',
    });
  });
  it.each([
    { customerRef: 'name@example.test' },
    { orderId: 'human-chosen-order' },
    { sessionId: '../another-session' },
    { callbackState: 'too-short' },
    { callbackState: `https://evil.test/${'x'.repeat(25)}` },
    { returnUrl: 'https://evil.test' },
    { amount: 1000 },
    { customerName: 'A real person' },
    { authKey: 'not-accepted-here' },
  ])('rejects extra/unsafe identity data %j', (override) => {
    expect(
      prepareTossBillingAuth(env(), { ...identity, ...override }),
    ).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('canonical callback construction', () => {
  it('also rejects invalid identity when called independently', () => {
    expect(
      preparationCallbacks(fixture.NEXT_PUBLIC_APP_URL, {
        ...identity,
        callbackState: 'raw-provider-secret',
      }),
    ).toBeNull();
  });
  it.each([
    'https://app.example.test/evil',
    'https://app.example.test/?return=https://evil.test',
    'https://user:password@app.example.test',
    'https://app.example.test/#secret',
    'javascript:alert(1)',
    'http://public.example.test',
  ])('rejects unsafe origins %s', (origin) => {
    expect(preparationCallbacks(origin, identity)).toBeNull();
  });
  it('rejects configured origins whose callback exceeds Kakao URL bound', () => {
    const origin = `https://${'a'.repeat(63)}.${'b'.repeat(63)}.example.test`;
    expect(preparationCallbacks(origin, identity)).toBeNull();
  });
  it('supports explicit loopback origins for local testing', () => {
    expect(
      preparationCallbacks('http://127.0.0.1:3100', identity)?.successUrl,
    ).toMatch(/^http:\/\/127\.0\.0\.1:3100\//);
  });
});

describe('KakaoPay zero-amount registration ready contract (offline only)', () => {
  it('sends exactly one documented SECRET_KEY JSON ready request, no charge', async () => {
    const http = transport();
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const adapter = createKakaoPayPreparationAdapter(env(), http);
    const result = await adapter.ready(identity);
    expect(result).toEqual({
      ok: true,
      data: {
        kind: 'kakaopay_registration_ready',
        tid: body.tid,
        redirects: {
          mobile: body.next_redirect_mobile_url,
          desktop: body.next_redirect_pc_url,
        },
        registrationAmountKrw: 0,
        launchAvailable: false,
      },
    });
    expect(http).toHaveBeenCalledTimes(1);
    const [url, request] = http.mock.calls[0]!;
    expect(url).toBe(KAKAOPAY_READY_URL);
    expect(request).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: `SECRET_KEY ${fixture.KAKAOPAY_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
      signal: expect.any(AbortSignal),
    });
    expect(timeout).toHaveBeenCalledWith(PAYMENT_PREPARATION_TIMEOUT_MS);
    expect(JSON.parse(request.body as string)).toEqual({
      cid: 'TCSUBSCRIP',
      partner_order_id: identity.orderId,
      partner_user_id: identity.customerRef,
      item_name: '자동결제 수단 등록',
      quantity: 1,
      total_amount: 0,
      tax_free_amount: 0,
      vat_amount: 0,
      approval_url: expect.any(String),
      cancel_url: expect.any(String),
      fail_url: expect.any(String),
    });
    expect(new Headers(request.headers).has('Idempotency-Key')).toBe(false);
    expect(Object.keys(adapter)).toEqual(['ready']);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('includes cid_secret only when genuinely configured, never in result', async () => {
    const http = transport();
    const result = await createKakaoPayPreparationAdapter(
      env({ KAKAOPAY_CID_SECRET: 'fictional-issued-secret' }),
      http,
    ).ready(identity);
    expect(JSON.parse(http.mock.calls[0]![1].body as string)).toHaveProperty(
      'cid_secret',
      'fictional-issued-secret',
    );
    expect(JSON.stringify(result)).not.toContain('fictional-issued-secret');
    expect(JSON.stringify(result)).not.toContain(fixture.KAKAOPAY_SECRET_KEY);
  });
  it.each([
    { PAYMENTS_MODE: 'disabled' },
    { KAKAOPAY_SUBSCRIPTION_ENABLED: 'false' },
    { KAKAOPAY_SECRET_KEY: '' },
    { KAKAOPAY_RECURRING_CID: '' },
  ])('never calls transport when unavailable %j', async (overrides) => {
    const http = transport();
    expect(
      await createKakaoPayPreparationAdapter(env(overrides), http).ready(
        identity,
      ),
    ).toMatchObject({
      ok: false,
      code: 'INTEGRATION_UNAVAILABLE',
      outcome: 'not_started',
    });
    expect(http).not.toHaveBeenCalled();
  });
  it('cannot accept a first-charge amount or raw provider credential', async () => {
    const http = transport();
    expect(
      await createKakaoPayPreparationAdapter(env(), http).ready({
        ...identity,
        amount: 1000,
        sid: 'sensitive',
      } as PreparationIdentity),
    ).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(http).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 404, 422])(
    'classifies documented-shape client HTTP %i as rejected, never retryable',
    async (status) => {
      const http = transport(
        json(
          { error_code: -400, error_message: 'sensitive-provider-text' },
          status,
        ),
      );
      expect(
        await createKakaoPayPreparationAdapter(env(), http).ready(identity),
      ).toEqual({
        ok: false,
        code: 'PROVIDER_REJECTED',
        outcome: 'rejected',
        retryAllowed: false,
      });
      expect(http).toHaveBeenCalledTimes(1);
    },
  );
  it.each([201, 301, 408, 409, 425, 429, 500, 502, 503])(
    'classifies HTTP %i as unknown and performs no automatic retry',
    async (status) => {
      const http = transport(json({ error_code: -1 }, status));
      expect(
        await createKakaoPayPreparationAdapter(env(), http).ready(identity),
      ).toEqual({
        ok: false,
        code: 'OUTCOME_UNKNOWN',
        outcome: 'unknown',
        retryAllowed: false,
      });
      expect(http).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps malformed client errors unknown rather than assuming rejection', async () => {
    const http = transport(json({ message: 'unrecognized response' }, 400));
    expect(
      await createKakaoPayPreparationAdapter(env(), http).ready(identity),
    ).toMatchObject({ ok: false, outcome: 'unknown' });
  });
  it.each([
    'https://evil.test/next',
    'https://online-pay.kakao.com.evil.test/next',
    'https://evil.test@online-pay.kakao.com/next',
    'https://online-pay.kakao.com:444/next',
    'http://online-pay.kakao.com/next',
    'https://online-pay.kakao.com/next#secret',
    'javascript:alert(1)',
    '//online-pay.kakao.com/next',
    'kakaotalk://payment/next',
  ])('does not hand off an unsafe provider redirect %s', async (url) => {
    const http = transport(json({ ...body, next_redirect_pc_url: url }));
    expect(
      await createKakaoPayPreparationAdapter(env(), http).ready(identity),
    ).toMatchObject({ ok: false, code: 'OUTCOME_UNKNOWN' });
  });
  it.each([
    'https://online-pay.kakao.com',
    'https://online-payment.kakaopay.com',
  ])('accepts only exact documented production origins: %s', async (origin) => {
    const http = transport(
      json({
        ...body,
        next_redirect_mobile_url: `${origin}/v1/fictional/mInfo`,
        next_redirect_pc_url: `${origin}/v1/fictional/info`,
      }),
    );
    expect(
      await createKakaoPayPreparationAdapter(
        env({
          PAYMENTS_MODE: 'live',
          NEXT_PUBLIC_TOSS_CLIENT_KEY: 'live_ck_fictional',
          TOSS_SECRET_KEY: 'live_sk_fictional',
          KAKAOPAY_RECURRING_CID: 'fictional-live-cid',
        }),
        http,
      ).ready(identity),
    ).toMatchObject({ ok: true, data: { launchAvailable: false } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects sandbox response redirects in live mode', async () => {
    const http = transport();
    expect(
      await createKakaoPayPreparationAdapter(
        env({
          PAYMENTS_MODE: 'live',
          NEXT_PUBLIC_TOSS_CLIENT_KEY: 'live_ck_fictional',
          TOSS_SECRET_KEY: 'live_sk_fictional',
          KAKAOPAY_RECURRING_CID: 'fictional-live-cid',
        }),
        http,
      ).ready(identity),
    ).toMatchObject({ ok: false, code: 'OUTCOME_UNKNOWN' });
  });
  it.each([
    {},
    { ...body, tid: '' },
    { ...body, tid: '\nsecret' },
    { ...body, next_redirect_mobile_url: undefined },
    { ...body, next_redirect_mobile_url: 'a'.repeat(2049) },
  ])('treats malformed success as unknown %j', async (value) => {
    const http = transport(json(value));
    expect(
      await createKakaoPayPreparationAdapter(env(), http).ready(identity),
    ).toMatchObject({ ok: false, code: 'OUTCOME_UNKNOWN' });
  });
  it('drops unknown raw fields instead of returning provider payloads', async () => {
    const http = transport(
      json({ ...body, sid: 'secret-sid', raw: { card_number: 'secret-card' } }),
    );
    const result = await createKakaoPayPreparationAdapter(env(), http).ready(
      identity,
    );
    expect(JSON.stringify(result)).not.toMatch(
      /secret-sid|secret-card|created_at/,
    );
  });
  it.each([
    () => new Response('<html>not-json</html>', { status: 200 }),
    () =>
      new Response('not-json', {
        headers: { 'Content-Type': 'application/json' },
      }),
    () => json({ ...body, extra: 'x'.repeat(PAYMENT_RESPONSE_MAX_BYTES) }),
    () =>
      new Response(null, { headers: { 'Content-Type': 'application/json' } }),
    () =>
      new Response(Uint8Array.of(0xff), {
        headers: { 'Content-Type': 'application/json' },
      }),
  ])(
    'bounds and rejects invalid response bodies without retry',
    async (response) => {
      const http = transport(response());
      expect(
        await createKakaoPayPreparationAdapter(env(), http).ready(identity),
      ).toMatchObject({ ok: false, code: 'OUTCOME_UNKNOWN' });
      expect(http).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    new Error('network error with secret token'),
    new DOMException('timeout with secret token', 'TimeoutError'),
    new DOMException('canceled with secret token', 'AbortError'),
  ])('does not propagate or retry transport failures %s', async (error) => {
    const http = vi.fn<PaymentPreparationTransport>().mockRejectedValue(error);
    const result = await createKakaoPayPreparationAdapter(env(), http).ready(
      identity,
    );
    expect(result).toEqual({
      ok: false,
      code: 'OUTCOME_UNKNOWN',
      outcome: 'unknown',
      retryAllowed: false,
    });
    expect(JSON.stringify(result)).not.toContain('secret token');
    expect(http).toHaveBeenCalledTimes(1);
  });
});
