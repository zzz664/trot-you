// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { INSTALL_BODY_LIMIT } from '@/config/install';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { routes } from '@/config/routes';
import { success, failure } from '@/lib/result';
import { installPost } from '@/server/install/http';

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  install: { read: vi.fn(), acknowledge: vi.fn(), complete: vi.fn() },
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/db/install', () => ({
  createInstallPort: () => mocks.install,
}));
const origin = 'https://app.example';
const profile = {
  id: 'a1100000-0000-4000-8000-000000000001',
  role: 'fan',
  onboarding_completed_at: null,
  is_restricted: false,
  restricted_until: null,
};
function context() {
  return {
    configuration: { appOrigin: origin },
    client: { fixture: 'actor' },
    port: {
      verifySubject: vi.fn().mockResolvedValue(success(profile.id)),
      readProfile: vi.fn().mockResolvedValue(success(profile)),
    },
    apply: (response: NextResponse) => {
      for (const [name, value] of Object.entries(AUTH_PRIVATE_HEADERS))
        response.headers.set(name, value);
      response.headers.set('x-fixture-cookie-applied', 'yes');
      return response;
    },
  };
}
function request(
  body: unknown = { action: 'acknowledge', choice: 'acknowledged' },
  source: string | null = origin,
  contentType = 'application/json',
) {
  const headers = new Headers({
    'Content-Type': contentType,
    Host: 'evil.example',
    'X-Forwarded-Host': 'evil.example',
  });
  if (source !== null) headers.set('Origin', source);
  return new NextRequest(`https://poisoned.example${routes.installSubmit}`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockReturnValue(context());
  mocks.install.acknowledge.mockResolvedValue({ ok: true, data: null });
});

describe('installation completion HTTP authority boundary', () => {
  it.each([null, 'null', 'https://evil.example', `${origin}.evil.test`])(
    'rejects foreign or absent Origin %s before session and mutation I/O',
    async (source) => {
      const configured = context();
      mocks.context.mockReturnValue(configured);
      const response = await installPost(request(undefined, source));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, code: 'FORBIDDEN' });
      expect(configured.port.verifySubject).not.toHaveBeenCalled();
      expect(mocks.install.acknowledge).not.toHaveBeenCalled();
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(response.headers.get('x-fixture-cookie-applied')).toBe('yes');
    },
  );
  it('uses configured origin despite hostile Host headers', async () => {
    const response = await installPost(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      next: routes.onboardingInstall,
    });
    expect(mocks.install.acknowledge).toHaveBeenCalledExactlyOnceWith(
      'acknowledged',
    );
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('does not perform a mutation with absent configured actor client', async () => {
    mocks.context.mockReturnValue({
      ...context(),
      configuration: null,
      client: null,
      port: null,
    });
    const response = await installPost(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(mocks.install.acknowledge).not.toHaveBeenCalled();
  });
  it('rejects anonymous sessions without relying on cookie presence', async () => {
    const configured = context();
    configured.port.verifySubject.mockResolvedValue(success(null));
    mocks.context.mockReturnValue(configured);
    const response = await installPost(request());
    expect(response.status).toBe(401);
    expect(mocks.install.acknowledge).not.toHaveBeenCalled();
  });
  it('fails closed on unavailable Auth or a subject/profile mismatch', async () => {
    for (const mismatch of [false, true]) {
      const configured = context();
      if (mismatch)
        configured.port.readProfile.mockResolvedValue(
          success({ ...profile, id: 'a1100000-0000-4000-8000-000000000002' }),
        );
      else configured.port.verifySubject.mockResolvedValue(failure('INTERNAL'));
      mocks.context.mockReturnValue(configured);
      const response = await installPost(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
    }
    expect(mocks.install.acknowledge).not.toHaveBeenCalled();
  });
  it.each([
    { ...profile, role: 'admin' },
    { ...profile, role: 'artist' },
    { ...profile, is_restricted: true },
    {
      ...profile,
      is_restricted: true,
      restricted_until: '2999-01-01T00:00:00Z',
    },
    { ...profile, is_restricted: true, restricted_until: 'invalid' },
  ])(
    'rejects nonfan/restricted/completed profile %j before selection',
    async (actor) => {
      const configured = context();
      configured.port.readProfile.mockResolvedValue(success(actor));
      mocks.context.mockReturnValue(configured);
      const response = await installPost(request());
      expect(response.status).toBe(403);
      expect(mocks.install.acknowledge).not.toHaveBeenCalled();
    },
  );
  it('does not retain an expired restriction', async () => {
    const configured = context();
    configured.port.readProfile.mockResolvedValue(
      success({
        ...profile,
        is_restricted: true,
        restricted_until: '2000-01-01T00:00:00Z',
      }),
    );
    mocks.context.mockReturnValue(configured);
    expect((await installPost(request())).status).toBe(200);
  });
  it.each([
    {},
    null,
    { slug: 'fictional-star', userId: 'victim' },
    { slug: 'fictional-star', actorId: 'victim' },
    { slug: 'fictional-star', subscribed: true },
    { slug: 'fictional-star', skip: true },
    { slug: '../hidden' },
    'not-json',
    `{"slug":"${'a'.repeat(INSTALL_BODY_LIMIT)}"}`,
  ])(
    'rejects unbounded, malformed, or privilege-bearing JSON %j',
    async (body) => {
      const response = await installPost(request(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
      expect(mocks.install.acknowledge).not.toHaveBeenCalled();
    },
  );
  it.each(['text/plain', 'application/x-www-form-urlencoded', ''])(
    'requires JSON content-type %s',
    async (contentType) => {
      expect(
        (await installPost(request(undefined, origin, contentType))).status,
      ).toBe(400);
      expect(mocks.install.acknowledge).not.toHaveBeenCalled();
    },
  );
  it('rejects an absent body and invalid UTF-8 rather than repairing input', async () => {
    for (const body of [null, new Uint8Array([0xff])]) {
      const response = await installPost(
        new NextRequest(`${origin}${routes.installSubmit}`, {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body,
        }),
      );
      expect(response.status).toBe(400);
    }
    expect(mocks.install.acknowledge).not.toHaveBeenCalled();
  });
  it.each([
    ['PROFILE_REQUIRED', 409],
    ['INTEREST_REQUIRED', 409],
    ['GUIDANCE_REQUIRED', 409],
    ['FORBIDDEN', 403],
    ['SETUP_NOT_READY', 503],
  ] as const)(
    'preserves current database gate %s without moving to install',
    async (code, status) => {
      mocks.install.acknowledge.mockResolvedValue({ ok: false, code });
      const response = await installPost(request());
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ ok: false, code });
    },
  );
  it('does not leak provider details or claim success after an uncertain write', async () => {
    mocks.install.acknowledge.mockRejectedValue(
      new Error('private SQL service key'),
    );
    const response = await installPost(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
});

it('allows a lost-response completion retry to revalidate through the transaction', async () => {
  const configured = context();
  configured.port.readProfile.mockResolvedValue(
    success({ ...profile, onboarding_completed_at: '2026-10-01T00:00:00Z' }),
  );
  mocks.context.mockReturnValue(configured);
  mocks.install.complete.mockResolvedValue({
    ok: true,
    data: '2026-10-01T00:00:00Z',
  });
  const response = await installPost(request({ action: 'complete' }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, next: routes.home });
  expect(mocks.install.complete).toHaveBeenCalledOnce();
});
