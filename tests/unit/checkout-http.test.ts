// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { CHECKOUT_BODY_LIMIT, CHECKOUT_NONCE_COOKIE } from '@/config/checkout';
import { routes } from '@/config/routes';
import { success, failure } from '@/lib/result';
import { checkoutPost, checkoutReturn } from '@/server/checkout/http';

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  service: vi.fn(),
  environment: vi.fn(),
  env: vi.fn(),
  port: { prepare: vi.fn(), read: vi.fn(), cancel: vi.fn() },
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/db/checkout-client', () => ({
  createCheckoutServiceClient: mocks.service,
}));
vi.mock('@/server/db/checkout', () => ({
  createCheckoutSessionPort: () => mocks.port,
}));
vi.mock('@/server/checkout/configuration', () => ({
  checkoutEnvironment: mocks.environment,
}));
vi.mock('@/config/env.server', () => ({ getServerEnv: mocks.env }));
const origin = 'https://app.example';
const profile = {
  id: 'c1100000-0000-4000-8000-000000000001',
  role: 'fan',
  onboarding_completed_at: '2026-10-24T12:00:00Z',
  is_restricted: false,
  restricted_until: null,
};
const input = {
  artistSlug: 'fictional-star',
  provider: 'toss_card_billing',
  policyVersion: 'c1100000-0000-4000-8000-000000000003',
  idempotencyKey: 'c1100000-0000-4000-8000-000000000004',
  accepted: true,
};
const session = {
  id: 'c1100000-0000-4000-8000-000000000002',
  status: 'pending_intent',
  provider: input.provider,
  expiresAt: '2026-10-24T12:15:00Z',
  nonceMatches: true,
  initialPriceKrw: 1000,
  regularPriceKrw: 6500,
  introEligible: true,
};
const nonce = 'n'.repeat(43);
const cookie = {
  actorId: profile.id,
  requestId: input.idempotencyKey,
  sessionId: session.id,
  nonce,
};
function context() {
  return {
    configuration: { appOrigin: origin },
    client: {},
    port: {
      verifySubject: vi.fn().mockResolvedValue(success(profile.id)),
      readProfile: vi.fn().mockResolvedValue(success(profile)),
    },
    apply(response: NextResponse) {
      for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
        response.headers.set(key, value);
      return response;
    },
  };
}
function request(
  body: unknown = input,
  source: string | null = origin,
  savedCookie?: unknown,
  contentType = 'application/json',
) {
  const headers = new Headers({
    'Content-Type': contentType,
    Host: 'evil.example',
    'X-Forwarded-Host': 'evil.example',
  });
  if (source !== null) headers.set('Origin', source);
  const req = new NextRequest(
    `https://poisoned.example${routes.checkoutSubmit}`,
    {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
  );
  if (savedCookie !== undefined)
    req.cookies.set(
      CHECKOUT_NONCE_COOKIE,
      typeof savedCookie === 'string'
        ? savedCookie
        : JSON.stringify(savedCookie),
    );
  return req;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockReturnValue(context());
  mocks.service.mockReturnValue({});
  mocks.environment.mockReturnValue('test');
  mocks.env.mockReturnValue(success({ NEXT_PUBLIC_APP_URL: origin }));
  mocks.port.prepare.mockResolvedValue({ ok: true, data: session });
  mocks.port.cancel.mockResolvedValue({ ok: true, data: null });
  mocks.port.read.mockResolvedValue({
    ok: true,
    data: { ...session, status: 'canceled' },
  });
});

describe('checkout POST authority and nonce boundary', () => {
  it.each([null, 'null', 'https://evil.example', `${origin}.evil.test`])(
    'rejects missing/foreign Origin %s before auth/mutation',
    async (source) => {
      const configured = context();
      mocks.context.mockReturnValue(configured);
      expect((await checkoutPost(request(input, source))).status).toBe(403);
      expect(configured.port.verifySubject).not.toHaveBeenCalled();
      expect(mocks.service).not.toHaveBeenCalled();
    },
  );
  it('binds cookie to verified actor/session and keeps nonce out of response JSON', async () => {
    const response = await checkoutPost(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        id: session.id,
        status: session.status,
        provider: session.provider,
        expiresAt: session.expiresAt,
        initialPriceKrw: 1000,
        regularPriceKrw: 6500,
        introEligible: true,
      },
    });
    const stored = response.cookies.get(CHECKOUT_NONCE_COOKIE)!;
    const parsed = JSON.parse(stored.value);
    expect(parsed).toMatchObject({
      actorId: profile.id,
      requestId: input.idempotencyKey,
      sessionId: session.id,
    });
    expect(parsed.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.port.prepare).toHaveBeenCalledWith(
      profile.id,
      input,
      'test',
      createHash('sha256').update(parsed.nonce).digest('hex'),
    );
    expect(stored).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: routes.checkoutSubmit,
    });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
  it('uses original nonce for same-key retry and never trusts hostile Host headers', async () => {
    const response = await checkoutPost(request(input, origin, cookie));
    expect(response.status).toBe(200);
    expect(mocks.port.prepare).toHaveBeenCalledExactlyOnceWith(
      profile.id,
      input,
      'test',
      createHash('sha256').update(nonce).digest('hex'),
    );
  });
  it.each([
    { ...cookie, actorId: 'c1100000-0000-4000-8000-000000000009' },
    { ...cookie, requestId: 'c1100000-0000-4000-8000-000000000009' },
    'not-json',
    { ...cookie, nonce: 'short' },
  ])(
    'never reuses another identity/request or malformed nonce %j',
    async (stored) => {
      const response = await checkoutPost(request(input, origin, stored));
      expect(response.status).toBe(200);
      expect(mocks.port.prepare.mock.calls[0]![3]).not.toBe(
        createHash('sha256').update(nonce).digest('hex'),
      );
    },
  );
  it('does not set a replacement nonce after a lost response/idempotency replay mismatch', async () => {
    mocks.port.prepare.mockResolvedValue({
      ok: true,
      data: { ...session, nonceMatches: false },
    });
    const response = await checkoutPost(request());
    expect(response.status).toBe(409);
    expect(response.cookies.get(CHECKOUT_NONCE_COOKIE)).toBeUndefined();
    expect(mocks.port.prepare).toHaveBeenCalledTimes(1);
  });
  it('fails closed with absent application/service configuration', async () => {
    mocks.service.mockReturnValue(null);
    expect((await checkoutPost(request())).status).toBe(503);
    expect(mocks.port.prepare).not.toHaveBeenCalled();
    mocks.context.mockReturnValue({
      ...context(),
      configuration: null,
      client: null,
      port: null,
    });
    expect((await checkoutPost(request())).status).toBe(503);
  });
  it('fails closed with unavailable provider config before session mutation', async () => {
    mocks.environment.mockReturnValue(null);
    const response = await checkoutPost(request());
    expect(await response.json()).toEqual({
      ok: false,
      code: 'PROVIDER_NOT_READY',
    });
    expect(mocks.port.prepare).not.toHaveBeenCalled();
  });
  it('requires verified authenticated subject and matched current profile', async () => {
    const configured = context();
    mocks.context.mockReturnValue(configured);
    configured.port.verifySubject.mockResolvedValue(success(null));
    expect((await checkoutPost(request())).status).toBe(401);
    configured.port.verifySubject.mockResolvedValue(failure('INTERNAL'));
    expect((await checkoutPost(request())).status).toBe(503);
    configured.port.verifySubject.mockResolvedValue(success(profile.id));
    configured.port.readProfile.mockResolvedValue(
      success({ ...profile, id: session.id }),
    );
    expect((await checkoutPost(request())).status).toBe(503);
    expect(mocks.port.prepare).not.toHaveBeenCalled();
  });
  it.each([
    { role: 'admin' },
    { role: 'artist' },
    { onboarding_completed_at: null },
    { is_restricted: true },
    { is_restricted: true, restricted_until: 'invalid' },
    { is_restricted: true, restricted_until: '2999-01-01T00:00:00Z' },
  ])('rejects ineligible actor %j', async (patch) => {
    const configured = context();
    configured.port.readProfile.mockResolvedValue(
      success({ ...profile, ...patch }),
    );
    mocks.context.mockReturnValue(configured);
    expect((await checkoutPost(request())).status).toBe(403);
    expect(mocks.port.prepare).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {},
    { ...input, userId: profile.id },
    { ...input, amount: 1 },
    { ...input, returnUrl: 'https://evil.test' },
    { ...input, authKey: 'secret' },
    { ...input, accepted: false },
    'bad-json',
    `{"artistSlug":"${'a'.repeat(CHECKOUT_BODY_LIMIT)}"}`,
  ])('rejects malformed/privileged/oversized request %j', async (body) => {
    expect((await checkoutPost(request(body))).status).toBe(400);
    expect(mocks.port.prepare).not.toHaveBeenCalled();
  });
  it.each(['text/plain', 'application/x-www-form-urlencoded', ''])(
    'rejects non-JSON %s',
    async (contentType) => {
      expect(
        (await checkoutPost(request(input, origin, undefined, contentType)))
          .status,
      ).toBe(400);
    },
  );
  it('cancels owned session with matching HttpOnly nonce and clears cookie', async () => {
    const response = await checkoutPost(
      request({ sessionId: session.id }, origin, cookie),
      'cancel',
    );
    expect(response.status).toBe(200);
    expect(mocks.port.cancel).toHaveBeenCalledExactlyOnceWith(
      profile.id,
      session.id,
      createHash('sha256').update(nonce).digest('hex'),
    );
    expect(response.cookies.get(CHECKOUT_NONCE_COOKIE)?.maxAge).toBe(0);
  });
  it.each([
    undefined,
    { ...cookie, actorId: session.id },
    { ...cookie, sessionId: profile.id },
    { ...cookie, nonce: 'bad' },
  ])('rejects missing/wrong cancellation cookie %j', async (stored) => {
    const response = await checkoutPost(
      request({ sessionId: session.id }, origin, stored),
      'cancel',
    );
    expect(response.status).toBe(403);
    expect(mocks.port.cancel).not.toHaveBeenCalled();
  });
  it('does not clear nonce on uncertain cancellation outcome', async () => {
    mocks.port.cancel.mockRejectedValue(new Error('provider-secret'));
    const response = await checkoutPost(
      request({ sessionId: session.id }, origin, cookie),
      'cancel',
    );
    expect(await response.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(response.cookies.get(CHECKOUT_NONCE_COOKIE)).toBeUndefined();
    expect(mocks.port.cancel).toHaveBeenCalledTimes(1);
  });
});

describe('unimplemented provider return is a read-only query scrubber', () => {
  it('uses a fixed canonical URL with no token, untrusted redirect, database/auth/provider side effect', () => {
    const response = checkoutReturn();
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `${origin}${routes.checkout}`,
    );
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('content-security-policy')).toContain(
      "default-src 'none'",
    );
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.service).not.toHaveBeenCalled();
    expect(mocks.port.prepare).not.toHaveBeenCalled();
    expect(mocks.port.cancel).not.toHaveBeenCalled();
  });
  it('does not use request Host when canonical environment is invalid', async () => {
    mocks.env.mockReturnValue(failure('CONFIGURATION_INVALID'));
    const response = checkoutReturn();
    expect(response.status).toBe(503);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.json()).toEqual({
      ok: false,
      code: 'COMPLETION_UNAVAILABLE',
    });
  });
});
