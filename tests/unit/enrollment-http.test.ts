// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  enrollmentPost,
  enrollmentReturn,
  enrollmentStatus,
} from '@/server/enrollment/http';
import {
  enrollmentCallbackState,
  enrollmentHash,
} from '@/server/enrollment/security';
import { CHECKOUT_NONCE_COOKIE } from '@/config/checkout';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { routes, enrollmentCompletePath } from '@/config/routes';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  deps: vi.fn(),
  env: vi.fn(),
  start: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  capture: vi.fn(),
  read: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/enrollment/dependencies', () => ({
  createEnrollmentDependencies: mocks.deps,
  createEnrollmentDatabaseDependencies: mocks.deps,
}));
vi.mock('@/config/env.server', () => ({ getServerEnv: mocks.env }));
vi.mock('@/server/services/enrollment/flow', () => ({
  startEnrollment: mocks.start,
  confirmEnrollment: mocks.confirm,
  cancelEnrollment: mocks.cancel,
  captureEnrollment: mocks.capture,
  readEnrollment: mocks.read,
  reconcileEnrollment: mocks.reconcile,
}));
const id = (n: number) =>
  `b1710000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const origin = 'https://app.example';
const nonce = 'n'.repeat(43);
const cookie = { actorId: id(1), requestId: id(2), sessionId: id(3), nonce };
const profile = {
  id: id(1),
  role: 'fan',
  onboarding_completed_at: '2026-10-24T12:00:00Z',
  is_restricted: false,
  restricted_until: null,
};
function context() {
  return {
    configuration: { appOrigin: origin },
    client: {
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: id(1), session_id: id(4) } },
          error: null,
        }),
      },
    },
    port: {
      verifySubject: vi.fn().mockResolvedValue({ ok: true, data: id(1) }),
      readProfile: vi.fn().mockResolvedValue({ ok: true, data: profile }),
    },
    apply(response: NextResponse) {
      for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
        response.headers.set(key, value);
      return response;
    },
  };
}
function post(
  body: unknown = { sessionId: id(3) },
  source: string | null = origin,
  saved: unknown = cookie,
) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (source !== null) headers.set('Origin', source);
  const request = new NextRequest(`${origin}${routes.enrollmentStart}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (saved !== null)
    request.cookies.set(CHECKOUT_NONCE_COOKIE, JSON.stringify(saved));
  return request;
}
function callback(
  params: Record<string, string> = {},
  saved: unknown = cookie,
) {
  const url = new URL(routes.checkoutReturn, origin);
  for (const [key, value] of Object.entries({
    session: id(3),
    state: enrollmentCallbackState(nonce),
    outcome: 'success',
    authKey: 'private_fixture_auth',
    customerKey: id(5),
    ...params,
  }))
    url.searchParams.set(key, value);
  const request = new NextRequest(url);
  if (saved !== null)
    request.cookies.set(CHECKOUT_NONCE_COOKIE, JSON.stringify(saved));
  return request;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockReturnValue(context());
  mocks.deps.mockReturnValue({ fixture: true });
  mocks.env.mockReturnValue({
    ok: true,
    data: { NEXT_PUBLIC_APP_URL: origin },
  });
  for (const fn of [
    mocks.start,
    mocks.confirm,
    mocks.cancel,
    mocks.capture,
    mocks.read,
    mocks.reconcile,
  ])
    fn.mockResolvedValue({
      ok: true,
      data: { status: 'awaiting_confirmation' },
    });
});
describe('enrollment HTTP security boundaries', () => {
  it.each([null, 'null', 'https://evil.example', `${origin}.evil.test`])(
    'requires exact Origin %s before auth or provider work',
    async (source) => {
      expect(
        (await enrollmentPost(post(undefined, source), 'start')).status,
      ).toBe(403);
      expect(mocks.deps).not.toHaveBeenCalled();
    },
  );
  it('binds start to verified auth session and secure original nonce', async () => {
    const response = await enrollmentPost(post(), 'start');
    expect(response.status).toBe(200);
    expect(mocks.start).toHaveBeenCalledWith(
      { fixture: true },
      {
        actorId: id(1),
        authSessionHash: enrollmentHash(id(4)),
        nonceHash: enrollmentHash(nonce),
      },
      { sessionId: id(3) },
      enrollmentCallbackState(nonce),
      enrollmentHash(enrollmentCallbackState(nonce)),
    );
    for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
      expect(response.headers.get(key)).toBe(value);
    expect(await response.text()).not.toContain(nonce);
  });
  it.each([
    null,
    { ...cookie, actorId: id(99) },
    { ...cookie, sessionId: id(99) },
    { ...cookie, nonce: 'x' },
  ])('denies missing/foreign/malformed nonce %j', async (saved) => {
    expect(
      (await enrollmentPost(post(undefined, origin, saved), 'confirm')).status,
    ).toBe(403);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it.each([
    { session_id: undefined },
    { session_id: 'invalid' },
    { sub: id(99), session_id: id(4) },
  ])('denies unverifiable auth-session binding %j', async (claims) => {
    const c = context();
    c.client.auth.getClaims.mockResolvedValue({
      data: { claims: { sub: id(1), ...claims } },
      error: null,
    });
    mocks.context.mockReturnValue(c);
    expect((await enrollmentPost(post(), 'start')).status).toBe(401);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('requires authenticated actor before dependencies', async () => {
    const c = context();
    c.port.verifySubject.mockResolvedValue({ ok: true, data: null });
    mocks.context.mockReturnValue(c);
    expect((await enrollmentPost(post(), 'start')).status).toBe(401);
    expect(mocks.deps).not.toHaveBeenCalled();
  });
  it.each(['start', 'confirm'] as const)(
    'restricted actor cannot %s',
    async (action) => {
      const c = context();
      c.port.readProfile.mockResolvedValue({
        ok: true,
        data: { ...profile, is_restricted: true },
      });
      mocks.context.mockReturnValue(c);
      expect((await enrollmentPost(post(), action)).status).toBe(403);
      expect(mocks.deps).not.toHaveBeenCalled();
    },
  );
  it('restricted actor may reconcile an already-dispatched order without new-charge authority', async () => {
    const c = context();
    c.port.readProfile.mockResolvedValue({
      ok: true,
      data: { ...profile, is_restricted: true },
    });
    mocks.context.mockReturnValue(c);
    expect((await enrollmentPost(post(), 'reconcile')).status).toBe(200);
    expect(mocks.reconcile).toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('restricted actor may request safe DB-validated abandonment', async () => {
    const c = context();
    c.port.readProfile.mockResolvedValue({
      ok: true,
      data: { ...profile, is_restricted: true },
    });
    mocks.context.mockReturnValue(c);
    expect((await enrollmentPost(post(), 'cancel')).status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalled();
  });
  it('configuration absence never selects fake success', async () => {
    mocks.deps.mockReturnValue(null);
    expect((await enrollmentPost(post(), 'confirm')).status).toBe(503);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('strictly bounds JSON before mutating', async () => {
    expect(
      (
        await enrollmentPost(
          post({ sessionId: id(3), noise: 'x'.repeat(2048) }),
          'start',
        )
      ).status,
    ).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('captures authorization on GET and redirects with no token values or provider calls', async () => {
    const response = await enrollmentReturn(callback());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `${origin}${enrollmentCompletePath(id(3))}`,
    );
    expect(mocks.capture).toHaveBeenCalledWith(
      { fixture: true },
      expect.objectContaining({
        actorId: id(1),
        authSessionHash: enrollmentHash(id(4)),
      }),
      id(3),
      enrollmentHash(enrollmentCallbackState(nonce)),
      { provider: 'toss', authKey: 'private_fixture_auth', customerKey: id(5) },
    );
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(await response.text()).toBe('');
    expect(JSON.stringify([...response.headers])).not.toContain(
      'private_fixture_auth',
    );
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "default-src 'none'",
    );
  });
  it.each([{ state: 'bad' }, { session: 'bad' }, { state: 's'.repeat(43) }])(
    'scrubs malformed or wrong callback correlation %j without capture',
    async (params) => {
      const response = await enrollmentReturn(callback(params));
      expect(response.headers.get('location')).toBe(
        `${origin}${routes.checkout}`,
      );
      expect(mocks.capture).not.toHaveBeenCalled();
    },
  );
  it.each(['failure', 'cancel'])(
    'provider %s GET never cancels or confirms a payment',
    async (outcome) => {
      await enrollmentReturn(
        callback({ outcome, code: 'secret_code', message: 'secret_message' }),
      );
      expect(mocks.capture).not.toHaveBeenCalled();
      expect(mocks.cancel).not.toHaveBeenCalled();
      expect(mocks.confirm).not.toHaveBeenCalled();
    },
  );
  it('denies callback duplicates and mixed provider parameters', async () => {
    const request = callback({ pg_token: 'private_other_token' });
    await enrollmentReturn(request);
    expect(mocks.capture).not.toHaveBeenCalled();
    const duplicate = callback();
    duplicate.nextUrl.searchParams.append('authKey', 'second');
    await enrollmentReturn(duplicate);
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it('accepts Kakao pg_token without treating it as payment', async () => {
    const req = callback();
    req.nextUrl.searchParams.delete('authKey');
    req.nextUrl.searchParams.delete('customerKey');
    req.nextUrl.searchParams.set('pg_token', 'private_pg_token');
    await enrollmentReturn(req);
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      id(3),
      expect.anything(),
      { provider: 'kakaopay', pgToken: 'private_pg_token' },
    );
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('wrong actor callback cannot capture another browser authorization', async () => {
    await enrollmentReturn(callback({}, { ...cookie, actorId: id(99) }));
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it('unknown capture error is scrubbed, never logged or redirected externally', async () => {
    mocks.capture.mockRejectedValue(new Error('secret_exception'));
    const response = await enrollmentReturn(callback());
    expect(response.status).toBe(303);
    expect(await response.text()).toBe('');
    expect(response.headers.get('location')).toBe(
      `${origin}${enrollmentCompletePath(id(3))}`,
    );
  });
  it('status requires current verified session but no callback token in URL or response', async () => {
    const request = new NextRequest(
      `${origin}${routes.enrollmentStatus}?session=${id(3)}`,
    );
    expect((await enrollmentStatus(request)).status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith(
      { fixture: true },
      { actorId: id(1), authSessionHash: enrollmentHash(id(4)) },
      { sessionId: id(3) },
    );
  });
  it.each([
    `session=${id(3)}&session=${id(3)}`,
    `session=${id(3)}&authKey=private`,
    `session=invalid`,
  ])('status rejects query pollution %s', async (query) => {
    expect(
      (
        await enrollmentStatus(
          new NextRequest(`${origin}${routes.enrollmentStatus}?${query}`),
        )
      ).status,
    ).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
