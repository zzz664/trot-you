import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelEnrollment,
  chooseKakaoEnrollmentRedirect,
  confirmEnrollment,
  isSafeEnrollmentLaunch,
  openTossEnrollment,
  readEnrollment,
  reconcileEnrollment,
  startEnrollment,
} from '@/client/enrollment';
import {
  ENROLLMENT_RESPONSE_MAX_BYTES,
  type EnrollmentConfirmInput,
  type EnrollmentLaunch,
  type EnrollmentStatus,
} from '@/config/enrollment';
import { TOSS_BILLING_SDK_URL } from '@/config/payment-preparation';
import { routes } from '@/config/routes';

const sessionId = 'ec3f74d6-0745-4a1f-ad46-42eac6fb9713';
const status: EnrollmentStatus = {
  sessionId,
  status: 'awaiting_authorization',
  provider: 'toss_card_billing',
  environment: 'test',
  artist: { slug: 'fictional-star', name: '허구 가수' },
  policy: {
    version: 'ae3f06df-e2b1-4c57-838b-c472bc460ab7',
    billingPeriodCalendar: 'utc_monthly_clamped',
    paymentTaxBasis: 'taxable_krw',
    title: '허구 약관',
    body: '테스트 본문',
  },
  amountKrw: 1000,
  regularPriceKrw: 6500,
  expiresAt: '2099-10-24T13:30:00+00:00',
  canConfirm: false,
  canCancel: true,
  canReconcile: false,
};
function callback(outcome: string) {
  const url = new URL(routes.checkoutReturn, window.location.origin);
  url.searchParams.set('session', sessionId);
  url.searchParams.set('state', 'A'.repeat(43));
  url.searchParams.set('outcome', outcome);
  return url.href;
}
const toss = (): Extract<EnrollmentLaunch, { kind: 'toss_billing_auth' }> => ({
  kind: 'toss_billing_auth',
  sdkUrl: TOSS_BILLING_SDK_URL,
  clientKey: 'test_ck_fixture',
  payment: { customerKey: '72b22340-3ec9-4bfb-a273-b8725f45efa5' },
  requestBillingAuth: {
    method: 'CARD',
    successUrl: callback('success'),
    failUrl: callback('failure'),
  },
});
const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
const unavailable = { ok: false, code: 'UNAVAILABLE' };
const input: EnrollmentConfirmInput = {
  sessionId,
  policyVersion: status.policy.version,
  amountKrw: status.amountKrw,
  accepted: true,
};

describe('enrollment browser API boundary', () => {
  it('starts once with only the opaque session reference and a validated provider descriptor', async () => {
    const data = { status, launch: toss() };
    fetchMock.mockResolvedValue(Response.json({ ok: true, data }));
    expect(await startEnrollment({ sessionId })).toEqual({ ok: true, data });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      routes.enrollmentStart,
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        body: JSON.stringify({ sessionId }),
      }),
    );
  });
  it('status GET never sends a charge or consent', async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true, data: status }));
    expect(await readEnrollment({ sessionId })).toEqual({
      ok: true,
      data: status,
    });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `${routes.enrollmentStatus}?session=${sessionId}`,
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );
    expect(fetchMock.mock.calls[0]![1]).not.toHaveProperty('body');
  });
  it('confirmation binds exact immutable displayed policy and amount', async () => {
    const success = {
      ...status,
      status: 'succeeded',
      canCancel: false,
    } as const;
    fetchMock.mockResolvedValue(Response.json({ ok: true, data: success }));
    expect(await confirmEnrollment(input)).toEqual({ ok: true, data: success });
    expect(fetchMock).toHaveBeenCalledWith(
      routes.enrollmentConfirm,
      expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }),
    );
  });
  it.each([cancelEnrollment, reconcileEnrollment])(
    'explicit cancellation/reconciliation calls are one POST without payment authority fields',
    async (action) => {
      fetchMock.mockResolvedValue(Response.json({ ok: true, data: status }));
      await action({ sessionId });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
        sessionId,
      });
    },
  );
  it.each([
    { ...input, accepted: false },
    { ...input, amountKrw: -1 },
    { ...input, amountKrw: 1.5 },
    { ...input, policyVersion: 'draft' },
    { ...input, sessionId: 'invalid' },
    { ...input, userId: 'other' },
    { ...input, nonce: 'private' },
    { ...input, authKey: 'private' },
  ])('rejects invalid/extra confirmation input %#', async (candidate) => {
    expect(
      await confirmEnrollment(candidate as EnrollmentConfirmInput),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    { ...status, sessionId: '72b22340-3ec9-4bfb-a273-b8725f45efa5' },
    { ...status, amountKrw: 2000 },
    {
      ...status,
      policy: {
        ...status.policy,
        version: '72b22340-3ec9-4bfb-a273-b8725f45efa5',
      },
    },
    { ...status, sid: 'private' },
    { ...status, status: 'active' },
  ])('rejects mismatched or sensitive result %#', async (data) => {
    fetchMock.mockResolvedValue(Response.json({ ok: true, data }));
    expect(await confirmEnrollment(input)).toEqual(unavailable);
  });
  it.each([
    { ok: true, data: status, authKey: 'private' },
    { ok: false, code: 'RAW_ERROR' },
    { ok: false, code: 'FORBIDDEN', detail: 'private' },
    null,
  ])('does not expose arbitrary response %#', async (body) => {
    fetchMock.mockResolvedValue(Response.json(body));
    expect(await readEnrollment({ sessionId })).toEqual(unavailable);
  });
  it('bounds response bytes, content type and HTTP success', async () => {
    for (const response of [
      new Response('private'),
      Response.json({ ok: true, data: status }, { status: 503 }),
      Response.json({ body: 'A'.repeat(ENROLLMENT_RESPONSE_MAX_BYTES) }),
    ]) {
      fetchMock.mockResolvedValueOnce(response);
      expect(await readEnrollment({ sessionId })).toEqual(unavailable);
    }
  });
  it('lost reply does not replay or turn into success', async () => {
    fetchMock.mockRejectedValue(new Error('private_provider_token'));
    expect(await confirmEnrollment(input)).toEqual(unavailable);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('safe provider launch', () => {
  it('calls the real Toss SDK shape without adding card data', async () => {
    const requestBillingAuth = vi.fn().mockResolvedValue(undefined);
    const payment = vi.fn().mockReturnValue({ requestBillingAuth });
    vi.stubGlobal('TossPayments', vi.fn().mockReturnValue({ payment }));
    const launch = toss();
    expect(await openTossEnrollment(launch, status)).toBe(true);
    expect(payment).toHaveBeenCalledWith(launch.payment);
    expect(requestBillingAuth).toHaveBeenCalledExactlyOnceWith(
      launch.requestBillingAuth,
    );
  });
  it('does not manufacture SDK success when SDK is absent or rejects', async () => {
    expect(await openTossEnrollment(toss(), status)).toBe(false);
    vi.stubGlobal('TossPayments', () => ({
      payment: () => ({
        requestBillingAuth: () => Promise.reject(new Error('private_token')),
      }),
    }));
    expect(await openTossEnrollment(toss(), status)).toBe(false);
  });
  it.each([
    'https://untrusted.example/callback',
    `${window.location.origin}${routes.checkoutReturn}?session=${sessionId}&state=${'A'.repeat(43)}&outcome=success&authKey=private`,
    `${window.location.origin}${routes.checkoutReturn}?session=${sessionId}&state=guessable&outcome=success`,
    `${window.location.origin}${routes.checkoutReturn}?session=${sessionId}&state=${'A'.repeat(43)}&outcome=failure`,
    `${window.location.origin}${routes.checkoutReturn}?session=${sessionId}&state=${'A'.repeat(43)}&outcome=success#private`,
  ])('refuses unsafe or mismatched callbacks %#', (url) => {
    const launch = toss();
    launch.requestBillingAuth.successUrl = url;
    expect(isSafeEnrollmentLaunch(launch, status)).toBe(false);
  });
  it('binds provider, environment and authorization stage', () => {
    expect(
      isSafeEnrollmentLaunch(toss(), { ...status, environment: 'live' }),
    ).toBe(false);
    expect(
      isSafeEnrollmentLaunch(toss(), {
        ...status,
        provider: 'kakaopay_subscription',
      }),
    ).toBe(false);
    expect(
      isSafeEnrollmentLaunch(toss(), { ...status, status: 'succeeded' }),
    ).toBe(false);
  });
  it.each([
    'https://online-pay.kakao.com.evil.test/x',
    'http://online-pay.kakao.com/x',
    'https://online-pay.kakao.com:8443/x',
    'https://private@online-pay.kakao.com/x',
    'https://online-pay.kakao.com/x#private',
    'javascript:alert(1)',
  ])('refuses unsafe Kakao redirect %s', (redirectUrl) => {
    expect(
      isSafeEnrollmentLaunch(
        {
          kind: 'kakaopay_redirect',
          redirectUrl,
          desktopRedirectUrl: 'https://online-pay.kakao.com/desktop',
        },
        { ...status, provider: 'kakaopay_subscription' },
      ),
    ).toBe(false);
  });
  it.each([
    'Mozilla Android Mobile',
    'Mozilla iPhone Mobile',
    'Mozilla iPad',
    'Mozilla iPod',
  ])('selects the validated mobile Kakao handoff for %s', (userAgent) => {
    const launch = {
      kind: 'kakaopay_redirect',
      redirectUrl: 'https://online-pay.kakao.com/mobile',
      desktopRedirectUrl: 'https://online-payment.kakaopay.com/desktop',
    } as const;
    expect(
      chooseKakaoEnrollmentRedirect(
        launch,
        { ...status, provider: 'kakaopay_subscription' },
        userAgent,
      ),
    ).toBe(launch.redirectUrl);
  });
  it('selects the validated desktop URL and rejects either poisoned alternative', () => {
    const launch = {
      kind: 'kakaopay_redirect',
      redirectUrl: 'https://online-pay.kakao.com/mobile',
      desktopRedirectUrl: 'https://online-payment.kakaopay.com/desktop',
    } as const;
    const kakao = { ...status, provider: 'kakaopay_subscription' } as const;
    expect(
      chooseKakaoEnrollmentRedirect(launch, kakao, 'Mozilla Windows Chrome'),
    ).toBe(launch.desktopRedirectUrl);
    expect(
      chooseKakaoEnrollmentRedirect(
        { ...launch, desktopRedirectUrl: 'https://evil.test' },
        kakao,
        'Mozilla Android',
      ),
    ).toBeNull();
    expect(
      chooseKakaoEnrollmentRedirect(
        { ...launch, redirectUrl: 'https://evil.test' },
        kakao,
        'Mozilla Windows',
      ),
    ).toBeNull();
  });
  it('allows only documented origins and test-only mockup host', () => {
    const kakao = { ...status, provider: 'kakaopay_subscription' } as const;
    expect(
      isSafeEnrollmentLaunch(
        {
          kind: 'kakaopay_redirect',
          desktopRedirectUrl: 'https://online-pay.kakao.com/desktop',
          redirectUrl: 'https://online-pay.kakao.com/payment',
        },
        kakao,
      ),
    ).toBe(true);
    expect(
      isSafeEnrollmentLaunch(
        {
          kind: 'kakaopay_redirect',
          desktopRedirectUrl: 'https://online-pay.kakao.com/desktop',
          redirectUrl: 'https://mockup-pg-web.kakao.com/payment',
        },
        { ...kakao, environment: 'live' },
      ),
    ).toBe(false);
  });
});

describe('explicit immutable calendar and tax policy metadata', () => {
  it.each([
    { ...status.policy, billingPeriodCalendar: undefined },
    { ...status.policy, billingPeriodCalendar: 'server_default' },
    { ...status.policy, billingPeriodCalendar: 'America/New_York' },
    { ...status.policy, paymentTaxBasis: undefined },
    { ...status.policy, paymentTaxBasis: 'tax_free' },
    { ...status.policy, paymentTaxBasis: 'assumed_taxable' },
    { ...status.policy, vatRate: 0.1 },
  ])(
    'rejects missing, unknown or extra policy metadata %# without a fallback',
    async (policy) => {
      fetchMock.mockResolvedValue(
        Response.json({ ok: true, data: { ...status, policy } }),
      );
      expect(await readEnrollment({ sessionId })).toEqual(unavailable);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['utc_monthly_clamped', 'seoul_monthly_clamped'] as const)(
    'preserves the exact approved %s policy marker',
    async (billingPeriodCalendar) => {
      const data = {
        ...status,
        policy: { ...status.policy, billingPeriodCalendar },
      };
      fetchMock.mockResolvedValue(Response.json({ ok: true, data }));
      expect(await readEnrollment({ sessionId })).toEqual({ ok: true, data });
    },
  );
  it('does not accept caller-controlled calendar or tax overrides in consent', async () => {
    for (const candidate of [
      { ...input, billingPeriodCalendar: 'seoul_monthly_clamped' },
      { ...input, paymentTaxBasis: 'taxable_krw' },
    ])
      expect(
        await confirmEnrollment(candidate as EnrollmentConfirmInput),
      ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
