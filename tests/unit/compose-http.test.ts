// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { COMPOSE_ERROR_STATUS } from '@/config/artist-compose';
import { artistComposeApiPath } from '@/config/routes';
import { composePost } from '@/server/artist-compose/http';
const mock = vi.hoisted(() => ({
  context: vi.fn(),
  port: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  preview: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mock.context }));
vi.mock('@/server/db/artist-compose', () => ({ createComposePort: mock.port }));
vi.mock('@/server/services/artist-compose/compose', () => ({
  readComposeContext: mock.read,
  saveComposeDraft: mock.save,
  previewComposeDraft: mock.preview,
  removeComposeMedia: mock.remove,
}));
const id = 'a3000000-0000-4000-8000-000000000001';
const slug = 'fictional-star';
const origin = 'https://app.example';
function context(role = 'artist') {
  return {
    configuration: { appOrigin: origin },
    client: { actor: true },
    port: {
      verifySubject: vi.fn().mockResolvedValue({ ok: true, data: id }),
      readProfile: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          id,
          role,
          onboarding_completed_at: '2026-10-24T00:00:00Z',
          is_restricted: false,
          restricted_until: null,
        },
      }),
    },
    apply(response: NextResponse) {
      Object.entries(AUTH_PRIVATE_HEADERS).forEach(([k, v]) =>
        response.headers.set(k, v),
      );
      return response;
    },
  };
}
function request(
  body: unknown = { messageId: null },
  source: string | null = origin,
  type = 'application/json',
  search = '',
) {
  const headers = new Headers({
    'Content-Type': type,
    Host: 'untrusted.example',
    'X-Forwarded-Host': 'untrusted.example',
  });
  if (source !== null) headers.set('Origin', source);
  return new NextRequest(
    `https://untrusted.example${artistComposeApiPath(slug)}${search}`,
    {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.context.mockReturnValue(context());
  mock.port.mockReturnValue({ actorComposePort: true });
  for (const fn of [mock.read, mock.save, mock.preview, mock.remove])
    fn.mockResolvedValue({ ok: true, data: { safe: true } });
});
describe('artist compose HTTP authority boundary', () => {
  it.each(['context', 'save', 'preview', 'remove'] as const)(
    'uses authenticated artist capability for %s',
    async (action) => {
      const response = await composePost(request(), slug, action);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, data: { safe: true } });
      for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
        expect(response.headers.get(key)).toBe(value);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(mock.port).toHaveBeenCalledExactlyOnceWith({ actor: true });
      const op = {
        context: mock.read,
        save: mock.save,
        preview: mock.preview,
        remove: mock.remove,
      }[action];
      expect(op).toHaveBeenCalledExactlyOnceWith(
        { actorComposePort: true },
        { slug, messageId: null },
      );
    },
  );
  it.each([
    null,
    'null',
    'https://untrusted.example',
    'https://app.example.evil',
    'http://app.example',
  ])('rejects origin %s before operation', async (origin) => {
    expect((await composePost(request({}, origin), slug, 'save')).status).toBe(
      403,
    );
    expect(mock.port).not.toHaveBeenCalled();
  });
  it.each(['fan', 'admin'])('does not trust %s as artist', async (role) => {
    mock.context.mockReturnValue(context(role));
    expect(
      (await composePost(request({ role: 'artist' }), slug, 'save')).status,
    ).toBe(403);
    expect(mock.save).not.toHaveBeenCalled();
  });
  it('denies current restriction even for a real artist', async () => {
    const c = context();
    c.port.readProfile.mockResolvedValue({
      ok: true,
      data: { id, role: 'artist', is_restricted: true, restricted_until: null },
    });
    mock.context.mockReturnValue(c);
    expect((await composePost(request(), slug, 'context')).status).toBe(403);
  });
  it.each(['?actorId=x', '?messageId=x', '?uploadId=x'])(
    'rejects metadata in query %s',
    async (search) => {
      expect(
        (
          await composePost(
            request({}, origin, 'application/json', search),
            slug,
            'context',
          )
        ).status,
      ).toBe(400);
      expect(mock.port).not.toHaveBeenCalled();
    },
  );
  it.each(['[]', 'null', 'true', '3', '"text"', '{broken', ''])(
    'rejects nonobject body %s',
    async (body) => {
      expect((await composePost(request(body), slug, 'save')).status).toBe(400);
      expect(mock.save).not.toHaveBeenCalled();
    },
  );
  it('rejects slug supplied in body instead of silently overwriting it', async () => {
    expect(
      (await composePost(request({ slug: 'other' }), slug, 'save')).status,
    ).toBe(400);
    expect(mock.save).not.toHaveBeenCalled();
  });
  it('rejects non JSON body', async () => {
    expect(
      (await composePost(request({}, origin, 'text/plain'), slug, 'save'))
        .status,
    ).toBe(400);
  });
  it('fails unconfigured and anonymous state closed', async () => {
    mock.context.mockReturnValue({ ...context(), client: null });
    expect((await composePost(request(), slug, 'save')).status).toBe(503);
    const c = context();
    c.port.verifySubject.mockResolvedValue({ ok: true, data: null });
    mock.context.mockReturnValue(c);
    expect((await composePost(request(), slug, 'save')).status).toBe(401);
  });
  it.each(Object.entries(COMPOSE_ERROR_STATUS))(
    'maps %s privately to %s',
    async (code, status) => {
      mock.save.mockResolvedValue({ ok: false, code });
      const response = await composePost(request(), slug, 'save');
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ ok: false, code });
      expect(response.headers.get('cache-control')).toContain('no-store');
    },
  );
});
