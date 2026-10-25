// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { routes } from '@/config/routes';
import { webPushHttp } from '@/server/webpush/http';
import { GET, POST, DELETE } from '@/app/api/push/subscribe/route';

const mocks = vi.hoisted(() => ({ context: vi.fn(), dependencies: vi.fn() }));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/webpush/dependencies', () => ({
  createWebPushSubscriptionDependencies: mocks.dependencies,
}));
const origin = 'https://app.example';
const actorId = 'a4000000-0000-4000-8000-000000000001';
const sessionId = 'a4000000-0000-4000-8000-000000000002';
const deviceId = 'a4000000-0000-4000-8000-000000000003';
const endpoint = 'https://fcm.googleapis.com/wp/synthetic';
const key = 'B'.repeat(87);
const input = {
  action: 'subscribe',
  applicationServerKey: 'B'.repeat(87),
  subscription: { endpoint, keys: { p256dh: key, auth: 'A'.repeat(22) } },
  consentVersion: 'ci-v1',
  confirmed: true,
};
const device = {
  configured: true,
  consentVersion: 'ci-v1',
  webpushEnabled: true,
  newMessage: true,
  deviceId,
  deviceActive: true,
};
function context() {
  return {
    configuration: { appOrigin: origin },
    client: {
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: actorId, session_id: sessionId } },
          error: null,
        }),
      },
    },
    port: {
      verifySubject: vi.fn().mockResolvedValue({ ok: true, data: actorId }),
      readProfile: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          id: actorId,
          role: 'fan',
          onboarding_completed_at: '2026-10-24T00:00:00Z',
          is_restricted: false,
          restricted_until: null,
        },
      }),
    },
    apply(response: NextResponse) {
      Object.entries(AUTH_PRIVATE_HEADERS).forEach(([key, value]) =>
        response.headers.set(key, value),
      );
      return response;
    },
  };
}
function deps() {
  return {
    publicKey: key,
    validateSubscription: vi.fn(() => true),
    port: {
      status: vi.fn().mockResolvedValue({ ok: true, data: device }),
      register: vi.fn().mockResolvedValue({ ok: true, data: deviceId }),
      revoke: vi.fn().mockResolvedValue({ ok: true, data: null }),
    },
  };
}
function request(
  method = 'POST',
  body: unknown = input,
  source: string | null = origin,
  search = '',
  type = 'application/json',
) {
  const headers = new Headers({
    'Content-Type': type,
    Host: 'hostile.example',
    'X-Forwarded-Host': 'hostile.example',
  });
  if (source !== null) headers.set('Origin', source);
  return new NextRequest(
    `https://hostile.example${routes.pushSubscription}${search}`,
    {
      method,
      headers,
      ...(method === 'GET' || method === 'HEAD'
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockReturnValue(context());
  mocks.dependencies.mockReturnValue(deps());
});
describe('webpush HTTP boundary', () => {
  it('routes supported verbs only to the guarded controller', () => {
    expect(GET).toBe(webPushHttp);
    expect(POST).toBe(webPushHttp);
    expect(DELETE).toBe(webPushHttp);
  });
  it('uses verified identity and subscription schema, returning no private keys or endpoint', async () => {
    const d = deps();
    mocks.dependencies.mockReturnValue(d);
    const response = await webPushHttp(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { ...device, publicKey: key },
    });
    expect(d.port.register).toHaveBeenCalledExactlyOnceWith(
      { actorId, sessionId },
      input.subscription,
      input.consentVersion,
    );
    for (const [header, value] of Object.entries(AUTH_PRIVATE_HEADERS))
      expect(response.headers.get(header)).toBe(value);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it('GET reads general state without endpoint query or provider send', async () => {
    const d = deps();
    mocks.dependencies.mockReturnValue(d);
    const response = await webPushHttp(request('GET', undefined, null));
    expect(response.status).toBe(200);
    expect(d.port.status).toHaveBeenCalledExactlyOnceWith(
      { actorId, sessionId },
      null,
    );
    expect(d.port.register).not.toHaveBeenCalled();
    expect(d.port.revoke).not.toHaveBeenCalled();
  });
  it('POST status keeps opaque endpoint out of URL and does not subscribe', async () => {
    const d = deps();
    mocks.dependencies.mockReturnValue(d);
    const response = await webPushHttp(
      request('POST', { action: 'status', endpoint }),
    );
    expect(response.status).toBe(200);
    expect(d.port.status).toHaveBeenCalledExactlyOnceWith(
      { actorId, sessionId },
      endpoint,
    );
    expect(d.port.register).not.toHaveBeenCalled();
  });
  it.each([
    null,
    'null',
    'https://hostile.example',
    'https://app.example.evil',
    'http://app.example',
  ])('rejects CSRF origin %j before touching dependencies', async (source) => {
    expect((await webPushHttp(request('POST', input, source))).status).toBe(
      403,
    );
    expect(mocks.dependencies).not.toHaveBeenCalled();
  });
  it.each([
    '?endpoint=' + encodeURIComponent(endpoint),
    '?actorId=' + actorId,
    '?sessionId=' + sessionId,
    '?token=hidden',
  ])('rejects URL capability %s', async (search) => {
    expect(
      (await webPushHttp(request('GET', undefined, null, search))).status,
    ).toBe(400);
    expect(mocks.dependencies).not.toHaveBeenCalled();
  });
  it.each(['PUT', 'PATCH', 'HEAD'])(
    'does not route %s into an operation',
    async (method) => {
      expect((await webPushHttp(request(method))).status).toBe(400);
      expect(mocks.dependencies).not.toHaveBeenCalled();
    },
  );
  it.each([
    null,
    {},
    [],
    { ...input, actorId },
    { ...input, sessionId },
    { ...input, confirmed: false },
    { ...input, subscription: { ...input.subscription, userId: actorId } },
    { action: 'status', endpoint, extra: true },
    { action: 'unknown' },
  ])('rejects malformed/authority-bearing JSON %#', async (body) => {
    const d = deps();
    mocks.dependencies.mockReturnValue(d);
    expect((await webPushHttp(request('POST', body))).status).toBe(400);
    expect(d.port.register).not.toHaveBeenCalled();
    expect(d.port.status).not.toHaveBeenCalled();
  });
  it.each(['text/plain', 'application/x-www-form-urlencoded'])(
    'rejects %s request body',
    async (type) => {
      expect(
        (await webPushHttp(request('POST', input, origin, '', type))).status,
      ).toBe(400);
    },
  );
  it.each(['artist', 'admin'])(
    'rejects %s subscription despite client-supplied confirmation',
    async (role) => {
      const c = context();
      c.port.readProfile.mockResolvedValue({
        ok: true,
        data: {
          id: actorId,
          role,
          onboarding_completed_at: '2026-10-24T00:00:00Z',
          is_restricted: false,
          restricted_until: null,
        },
      });
      mocks.context.mockReturnValue(c);
      expect((await webPushHttp(request())).status).toBe(403);
      expect(mocks.dependencies).not.toHaveBeenCalled();
    },
  );
  it.each([
    { is_restricted: true, restricted_until: null },
    { onboarding_completed_at: null },
  ])('rejects ineligible fan %# before registry', async (change) => {
    const c = context();
    c.port.readProfile.mockResolvedValue({
      ok: true,
      data: {
        id: actorId,
        role: 'fan',
        onboarding_completed_at: '2026-10-24T00:00:00Z',
        is_restricted: false,
        restricted_until: null,
        ...change,
      },
    });
    mocks.context.mockReturnValue(c);
    expect((await webPushHttp(request())).status).toBe(403);
    expect(mocks.dependencies).not.toHaveBeenCalled();
  });
  it('allows restricted actor to disable only verified own registration', async () => {
    const c = context();
    c.port.readProfile.mockResolvedValue({
      ok: true,
      data: {
        id: actorId,
        role: 'fan',
        onboarding_completed_at: '2026-10-24T00:00:00Z',
        is_restricted: true,
        restricted_until: null,
      },
    });
    mocks.context.mockReturnValue(c);
    const d = deps();
    mocks.dependencies.mockReturnValue(d);
    expect((await webPushHttp(request('DELETE', { endpoint }))).status).toBe(
      200,
    );
    expect(d.port.revoke).toHaveBeenCalledExactlyOnceWith(
      { actorId, sessionId },
      endpoint,
    );
  });
  it.each(['configuration', 'client', 'port'] as const)(
    'fails missing %s closed',
    async (key) => {
      mocks.context.mockReturnValue({ ...context(), [key]: null });
      expect((await webPushHttp(request())).status).toBe(503);
      expect(mocks.dependencies).not.toHaveBeenCalled();
    },
  );
  it('does not accept unverified current subject or mismatched session claims', async () => {
    const c = context();
    c.client.auth.getClaims.mockResolvedValue({
      data: { claims: { sub: sessionId, session_id: sessionId } },
      error: null,
    });
    mocks.context.mockReturnValue(c);
    expect((await webPushHttp(request())).status).toBe(401);
    expect(mocks.dependencies).not.toHaveBeenCalled();
  });
  it.each([
    { ok: true, data: null },
    { ok: false, code: 'INTERNAL' },
  ])('rejects anonymous/unavailable Auth %#', async (result) => {
    const c = context();
    c.port.verifySubject.mockResolvedValue(result);
    mocks.context.mockReturnValue(c);
    const response = await webPushHttp(request());
    expect(response.status).toBe(result.ok ? 401 : 503);
    expect(mocks.dependencies).not.toHaveBeenCalled();
  });
  it('does not fake success without registry configuration', async () => {
    mocks.dependencies.mockReturnValue(null);
    expect((await webPushHttp(request())).status).toBe(503);
  });
  it('redacts unexpected exceptions without a registration retry', async () => {
    const d = deps();
    d.port.register.mockRejectedValueOnce(new Error('PRIVATE_ENDPOINT_SECRET'));
    mocks.dependencies.mockReturnValue(d);
    const response = await webPushHttp(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('PRIVATE');
    expect(d.port.register).toHaveBeenCalledOnce();
  });
});
