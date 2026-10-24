// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { MEDIA_BODY_LIMIT } from '@/config/media';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { routes } from '@/config/routes';
import { mediaPost } from '@/server/media/http';
import { mediaJson } from '@/server/media/security';
const mock = vi.hoisted(() => ({
  context: vi.fn(),
  deps: vi.fn(),
  begin: vi.fn(),
  complete: vi.fn(),
  read: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mock.context }));
vi.mock('@/server/media/dependencies', () => ({
  createMediaDependencies: mock.deps,
}));
vi.mock('@/server/services/media/access', () => ({
  beginMediaUpload: mock.begin,
  completeMediaUpload: mock.complete,
  readMediaUrl: mock.read,
  revokeMediaUpload: mock.revoke,
}));
const actor = 'a1000000-0000-4000-8000-000000000001';
const origin = 'https://app.example';
const body = { mediaId: 'a1000000-0000-4000-8000-000000000002', preview: true };
function context(role = 'fan') {
  return {
    configuration: { appOrigin: origin },
    client: { actor: true },
    port: {
      verifySubject: vi.fn().mockResolvedValue({ ok: true, data: actor }),
      readProfile: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          id: actor,
          role,
          onboarding_completed_at: null,
          is_restricted: false,
          restricted_until: null,
        },
      }),
    },
    apply: (response: NextResponse) => {
      for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
        response.headers.set(key, value);
      response.headers.set('x-cookie-applied', 'yes');
      return response;
    },
  };
}
function request(
  value: unknown = body,
  source: string | null = origin,
  contentType = 'application/json',
  search = '',
) {
  const headers = new Headers({
    'Content-Type': contentType,
    Host: 'evil.test',
    'X-Forwarded-Host': 'evil.test',
  });
  if (source !== null) headers.set('Origin', source);
  return new NextRequest(
    `https://poisoned.example${routes.mediaRead}${search}`,
    {
      method: 'POST',
      headers,
      body: typeof value === 'string' ? value : JSON.stringify(value),
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.context.mockReturnValue(context());
  mock.deps.mockReturnValue({ fixture: true });
  for (const fn of [mock.begin, mock.complete, mock.read, mock.revoke])
    fn.mockResolvedValue({ ok: true, data: null });
});
describe('media HTTP identity, CSRF and no-cache boundary', () => {
  it.each([
    null,
    'null',
    'https://evil.test',
    `${origin}.evil.test`,
    'http://app.example',
  ])(
    'rejects missing/foreign origin %s before credentials or I/O',
    async (source) => {
      const ctx = context();
      mock.context.mockReturnValue(ctx);
      const response = await mediaPost(request(body, source), 'read');
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, code: 'FORBIDDEN' });
      expect(ctx.port.verifySubject).not.toHaveBeenCalled();
      expect(mock.deps).not.toHaveBeenCalled();
      expect(response.headers.get('cache-control')).toContain('no-store');
    },
  );
  it('uses configured origin, verifies identity, and permits readiness-aware preview before finished onboarding', async () => {
    const response = await mediaPost(request(), 'read');
    expect(response.status).toBe(200);
    expect(mock.read).toHaveBeenCalledExactlyOnceWith(
      { fixture: true },
      actor,
      body,
    );
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-cookie-applied')).toBe('yes');
  });
  it.each(['?path=private/object', '?mediaId=foo', '?preview=true'])(
    'rejects query input %s',
    async (search) => {
      const response = await mediaPost(
        request(body, origin, 'application/json', search),
        'read',
      );
      expect(response.status).toBe(400);
      expect(mock.read).not.toHaveBeenCalled();
    },
  );
  it('requires configuration rather than pretending storage is active', async () => {
    mock.context.mockReturnValue({
      ...context(),
      configuration: null,
      client: null,
      port: null,
    });
    const response = await mediaPost(request(), 'read');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
  });
  it('does not authorize based on a cookie without verified Auth user', async () => {
    const ctx = context();
    ctx.port.verifySubject.mockResolvedValue({ ok: true, data: null });
    mock.context.mockReturnValue(ctx);
    const response = await mediaPost(request(), 'read');
    expect(response.status).toBe(401);
    expect(mock.deps).not.toHaveBeenCalled();
  });
  it('does not authorize a mismatched live profile', async () => {
    const ctx = context();
    ctx.port.readProfile.mockResolvedValue({
      ok: true,
      data: {
        id: 'b1000000-0000-4000-8000-000000000001',
        role: 'fan',
        onboarding_completed_at: null,
        is_restricted: false,
        restricted_until: null,
      },
    });
    mock.context.mockReturnValue(ctx);
    const response = await mediaPost(request(), 'read');
    expect(response.status).toBe(503);
    expect(mock.read).not.toHaveBeenCalled();
  });
  it.each(['begin', 'complete', 'revoke'] as const)(
    'fan cannot initiate artist upload action %s',
    async (action) => {
      const response = await mediaPost(request(), action);
      expect(response.status).toBe(403);
      expect(mock.deps).not.toHaveBeenCalled();
    },
  );
  it.each(['artist', 'admin'])(
    'passes verified %s to resource-aware service, never elevates client-supplied actor',
    async (role) => {
      mock.context.mockReturnValue(context(role));
      for (const [action, fn] of [
        ['begin', mock.begin],
        ['complete', mock.complete],
        ['revoke', mock.revoke],
        ['read', mock.read],
      ] as const) {
        const response = await mediaPost(request(), action);
        expect(response.status).toBe(200);
        expect(fn).toHaveBeenCalledWith({ fixture: true }, actor, body);
      }
    },
  );
  it.each(['fan', 'artist', 'admin'])(
    'denies currently restricted %s',
    async (role) => {
      const ctx = context(role);
      ctx.port.readProfile.mockResolvedValue({
        ok: true,
        data: {
          id: actor,
          role,
          onboarding_completed_at: null,
          is_restricted: true,
          restricted_until: null,
        },
      });
      mock.context.mockReturnValue(ctx);
      const response = await mediaPost(request(), 'read');
      expect(response.status).toBe(403);
      expect(mock.deps).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['not-json', 'application/json'],
    ['{"bad":', 'application/json'],
    ['{}', 'text/plain'],
    [' '.repeat(MEDIA_BODY_LIMIT + 1), 'application/json'],
  ])('rejects malformed/bounded JSON', async (value, type) => {
    const response = await mediaPost(request(value, origin, type), 'read');
    expect(response.status).toBe(400);
    expect(mock.deps).not.toHaveBeenCalled();
  });
  it('requires configured real media dependencies', async () => {
    mock.deps.mockReturnValue(null);
    const response = await mediaPost(request(), 'read');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(mock.read).not.toHaveBeenCalled();
  });
  it.each([
    ['INVALID_INPUT', 400],
    ['FORBIDDEN', 403],
    ['NOT_FOUND', 404],
    ['EXPIRED', 410],
    ['LIMIT_EXCEEDED', 409],
    ['INVALID_CONTENT', 422],
    ['UNAVAILABLE', 503],
  ])('maps safe service %s', async (code, status) => {
    mock.read.mockResolvedValue({ ok: false, code });
    const response = await mediaPost(request(), 'read');
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, code });
  });
});
describe('bounded, strict media JSON parsing', () => {
  it('rejects invalid UTF8 bytes instead of silently changing input', async () => {
    const invalid = new Request('https://app.example', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125]),
    });
    await expect(mediaJson(invalid)).rejects.toThrow();
  });
  it('accepts JSON split across chunks, including multibyte content', async () => {
    const bytes = new TextEncoder().encode('{"x":"사진"}');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    const req = new Request('https://app.example', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(await mediaJson(req)).toEqual({ x: '사진' });
  });
  it('cancels stalled body readers at the finite timeout', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream({ cancel });
    const req = new Request('https://app.example', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    const pending = expect(mediaJson(req)).rejects.toThrow('INVALID_INPUT');
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(cancel).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
