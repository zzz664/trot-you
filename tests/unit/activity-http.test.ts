// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { ACTIVITY_ERROR_STATUS } from '@/config/artist-reply-activity';
import { artistReplyActivityApiPath } from '@/config/routes';
import { artistReplyActivityPost } from '@/server/artist-reply-activity/http';
import { POST as contextRoute } from '@/app/api/artist/[slug]/replies/route';
import { POST as messagesRoute } from '@/app/api/artist/[slug]/replies/messages/route';
const mock = vi.hoisted(() => ({
  context: vi.fn(),
  port: vi.fn(),
  read: vi.fn(),
  messages: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mock.context }));
vi.mock('@/server/db/artist-reply-activity', () => ({
  createArtistReplyActivityPort: mock.port,
}));
vi.mock('@/server/services/artist-reply-activity/activity', () => ({
  readArtistReplyActivityPage: mock.read,
  readArtistReplyActivityMessages: mock.messages,
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
    `https://untrusted.example${artistReplyActivityApiPath(slug)}${search}`,
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
  mock.port.mockReturnValue({ artistActivityPort: true });
  for (const fn of [mock.read, mock.messages])
    fn.mockResolvedValue({ ok: true, data: { safe: true } });
});
describe('artist reply activity HTTP authority boundary', () => {
  it.each(['context', 'messages'] as const)(
    'uses authenticated artist capability for %s',
    async (action) => {
      const body = action === 'context' ? { messageId: null } : {};
      const response = await artistReplyActivityPost(
        request(body),
        slug,
        action,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, data: { safe: true } });
      for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
        expect(response.headers.get(key)).toBe(value);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(mock.port).toHaveBeenCalledExactlyOnceWith({ actor: true });
      const op = {
        context: mock.read,
        messages: mock.messages,
      }[action];
      expect(op).toHaveBeenCalledExactlyOnceWith(
        { artistActivityPort: true },
        { ...body, slug },
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
    expect(
      (await artistReplyActivityPost(request({}, origin), slug, 'messages'))
        .status,
    ).toBe(403);
    expect(mock.port).not.toHaveBeenCalled();
  });
  it.each(['fan', 'admin'])('does not trust %s as artist', async (role) => {
    mock.context.mockReturnValue(context(role));
    expect(
      (
        await artistReplyActivityPost(
          request({ role: 'artist' }),
          slug,
          'messages',
        )
      ).status,
    ).toBe(403);
    expect(mock.messages).not.toHaveBeenCalled();
  });
  it('denies current restriction even for a real artist', async () => {
    const c = context();
    c.port.readProfile.mockResolvedValue({
      ok: true,
      data: { id, role: 'artist', is_restricted: true, restricted_until: null },
    });
    mock.context.mockReturnValue(c);
    expect(
      (await artistReplyActivityPost(request(), slug, 'context')).status,
    ).toBe(403);
  });
  it('requires completed onboarding before reading artist reply data', async () => {
    const c = context();
    c.port.readProfile.mockResolvedValue({
      ok: true,
      data: {
        id,
        role: 'artist',
        onboarding_completed_at: null,
        is_restricted: false,
        restricted_until: null,
      },
    });
    mock.context.mockReturnValue(c);
    expect(
      (await artistReplyActivityPost(request(), slug, 'context')).status,
    ).toBe(403);
    expect(mock.port).not.toHaveBeenCalled();
  });
  it('allows an artist whose temporary restriction has expired', async () => {
    const c = context();
    c.port.readProfile.mockResolvedValue({
      ok: true,
      data: {
        id,
        role: 'artist',
        onboarding_completed_at: '2026-10-24T00:00:00Z',
        is_restricted: true,
        restricted_until: '2020-01-01T00:00:00Z',
      },
    });
    mock.context.mockReturnValue(c);
    expect(
      (await artistReplyActivityPost(request(), slug, 'context')).status,
    ).toBe(200);
    expect(mock.read).toHaveBeenCalledOnce();
  });
  it.each(['?actorId=x', '?messageId=x', '?cursor=x'])(
    'rejects metadata in query %s',
    async (search) => {
      expect(
        (
          await artistReplyActivityPost(
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
      expect(
        (await artistReplyActivityPost(request(body), slug, 'messages')).status,
      ).toBe(400);
      expect(mock.messages).not.toHaveBeenCalled();
    },
  );
  it('rejects slug supplied in body instead of silently overwriting it', async () => {
    expect(
      (
        await artistReplyActivityPost(
          request({ slug: 'other' }),
          slug,
          'messages',
        )
      ).status,
    ).toBe(400);
    expect(mock.messages).not.toHaveBeenCalled();
  });
  it('rejects non JSON body', async () => {
    expect(
      (
        await artistReplyActivityPost(
          request({}, origin, 'text/plain'),
          slug,
          'messages',
        )
      ).status,
    ).toBe(400);
  });
  it('fails unconfigured and anonymous state closed', async () => {
    mock.context.mockReturnValue({ ...context(), client: null });
    expect(
      (await artistReplyActivityPost(request(), slug, 'messages')).status,
    ).toBe(503);
    const c = context();
    c.port.verifySubject.mockResolvedValue({ ok: true, data: null });
    mock.context.mockReturnValue(c);
    expect(
      (await artistReplyActivityPost(request(), slug, 'messages')).status,
    ).toBe(401);
  });
  it.each(['configuration', 'client', 'port'])(
    'does not read replies when %s is unconfigured',
    async (missing) => {
      mock.context.mockReturnValue({ ...context(), [missing]: null });
      expect(
        (await artistReplyActivityPost(request(), slug, 'context')).status,
      ).toBe(503);
      expect(mock.read).not.toHaveBeenCalled();
    },
  );
  it('does not replace a failed session verification with anonymous success', async () => {
    const c = context();
    c.port.verifySubject.mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL' },
    });
    mock.context.mockReturnValue(c);
    const response = await artistReplyActivityPost(request(), slug, 'context');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(mock.port).not.toHaveBeenCalled();
  });
  it('does not authorize a profile for a different verified subject', async () => {
    const c = context();
    c.port.readProfile.mockResolvedValue({
      ok: true,
      data: { id: 'a3000000-0000-4000-8000-000000000002', role: 'artist' },
    });
    mock.context.mockReturnValue(c);
    expect(
      (await artistReplyActivityPost(request(), slug, 'context')).status,
    ).toBe(503);
    expect(mock.read).not.toHaveBeenCalled();
  });
  it('passes each thin route to the correct read operation with promised parameters', async () => {
    await contextRoute(request({ messageId: id, cursor: 'opaque' }), {
      params: Promise.resolve({ slug }),
    });
    expect(mock.read).toHaveBeenCalledExactlyOnceWith(
      { artistActivityPort: true },
      { slug, messageId: id, cursor: 'opaque' },
    );
    await messagesRoute(request({ cursor: 'older' }), {
      params: Promise.resolve({ slug }),
    });
    expect(mock.messages).toHaveBeenCalledExactlyOnceWith(
      { artistActivityPort: true },
      { slug, cursor: 'older' },
    );
  });
  it.each(Object.entries(ACTIVITY_ERROR_STATUS))(
    'maps %s privately to %s',
    async (code, status) => {
      mock.messages.mockResolvedValue({ ok: false, code });
      const response = await artistReplyActivityPost(
        request(),
        slug,
        'messages',
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ ok: false, code });
      expect(response.headers.get('cache-control')).toContain('no-store');
    },
  );
});
