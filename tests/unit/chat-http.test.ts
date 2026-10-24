// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { CHAT_BODY_LIMIT, CHAT_ERROR_STATUS } from '@/config/chat';
import { chatMessagesPath, chatReadPath } from '@/config/routes';
import { chatMessagesGet, chatReadPost } from '@/server/chat/http';

const mock = vi.hoisted(() => ({
  context: vi.fn(),
  serviceClient: vi.fn(),
  pagePort: vi.fn(),
  readPort: vi.fn(),
  page: vi.fn(),
  mark: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mock.context }));
vi.mock('@/server/db/chat-client', () => ({
  createChatServiceClient: mock.serviceClient,
}));
vi.mock('@/server/db/chat', () => ({
  createChatPagePort: mock.pagePort,
  createChatReadPort: mock.readPort,
}));
vi.mock('@/server/services/chat/read', () => ({
  readChatPage: mock.page,
  markChatRead: mock.mark,
}));
const actor = 'a1900000-0000-4000-8000-000000000001';
const messageId = 'a1900000-0000-4000-8000-000000000002';
const slug = 'fictional-star';
const origin = 'https://app.example';
const page = {
  artist: { slug, name: '허구 가수', description: null },
  hasAccess: true,
  messages: [],
  nextCursor: null,
  readCount: 0,
};
function context(role = 'fan') {
  return {
    configuration: { appOrigin: origin },
    client: { actorCapability: true },
    port: {
      verifySubject: vi.fn().mockResolvedValue({ ok: true, data: actor }),
      readProfile: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          id: actor,
          role,
          onboarding_completed_at: '2026-10-24T00:00:00Z',
          is_restricted: false,
          restricted_until: null,
        },
      }),
    },
    apply(response: NextResponse) {
      for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
        response.headers.set(key, value);
      response.headers.set('x-cookie-applied', 'yes');
      return response;
    },
  };
}
function get(search = '') {
  return new NextRequest(`${origin}${chatMessagesPath(slug)}${search}`);
}
function post(
  body: unknown = {},
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
    `https://untrusted.example${chatReadPath(slug, messageId)}${search}`,
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
  mock.serviceClient.mockReturnValue({ serviceCapability: true });
  mock.pagePort.mockReturnValue({ trustedPage: true });
  mock.readPort.mockReturnValue({ actorRead: true });
  mock.page.mockResolvedValue({ ok: true, data: page });
  mock.mark.mockResolvedValue({
    ok: true,
    data: { messageId, readAt: '2026-10-24T00:00:01.123456Z', readCount: 1 },
  });
});

describe('chat GET verified-session pagination boundary', () => {
  it('uses verified actor, bounded service input, no-store and cookie refresh response', async () => {
    const response = await chatMessagesGet(get('?cursor=YWJj&limit=30'), slug);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: page });
    expect(mock.page).toHaveBeenCalledExactlyOnceWith(
      { trustedPage: true },
      actor,
      { slug, cursor: 'YWJj', limit: 30 },
    );
    expect(mock.pagePort).toHaveBeenCalledExactlyOnceWith({
      serviceCapability: true,
    });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-cookie-applied')).toBe('yes');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it('leaves absent limit and cursor to service defaults', async () => {
    await chatMessagesGet(get(), slug);
    expect(mock.page).toHaveBeenCalledExactlyOnceWith(
      { trustedPage: true },
      actor,
      { slug },
    );
  });
  it.each([
    '?actorId=other',
    '?hasAccess=true',
    '?cursor=x&cursor=y',
    '?limit=30&limit=30',
    '?limit=',
    '?limit=0',
    '?limit=-1',
    '?limit=01',
    '?limit=1.5',
    '?limit=1e2',
    '?limit=%2030',
    '?limit=30%20',
    '?limit=Infinity',
  ])('rejects noncanonical or duplicate transport input %s', async (search) => {
    const response = await chatMessagesGet(get(search), slug);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(mock.serviceClient).not.toHaveBeenCalled();
    expect(mock.page).not.toHaveBeenCalled();
  });
  it('reports loss of paid access instead of changing a paid feed to preview data', async () => {
    mock.page.mockResolvedValue({
      ok: true,
      data: { ...page, hasAccess: false },
    });
    const response = await chatMessagesGet(get(), slug);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SUBSCRIPTION_REQUIRED',
    });
  });
  it('requires configured service capability for paid raw-template projection', async () => {
    mock.serviceClient.mockReturnValue(null);
    const response = await chatMessagesGet(get(), slug);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(mock.page).not.toHaveBeenCalled();
  });
});

describe('read POST uses only same-origin route-bound identifiers', () => {
  it('uses actor client, not service role or caller actor, and returns only committed read evidence', async () => {
    const ctx = context();
    mock.context.mockReturnValue(ctx);
    const response = await chatReadPost(post(), slug, messageId);
    expect(response.status).toBe(200);
    expect(mock.readPort).toHaveBeenCalledExactlyOnceWith(ctx.client);
    expect(mock.mark).toHaveBeenCalledExactlyOnceWith(
      { actorRead: true },
      { slug, messageId },
    );
    expect(mock.serviceClient).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-cookie-applied')).toBe('yes');
  });
  it.each([
    null,
    'null',
    'https://other.example',
    `${origin}.other.example`,
    'http://app.example',
  ])(
    'rejects absent/foreign origin %s before session verification or write',
    async (source) => {
      const ctx = context();
      mock.context.mockReturnValue(ctx);
      const response = await chatReadPost(post({}, source), slug, messageId);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, code: 'FORBIDDEN' });
      expect(ctx.port.verifySubject).not.toHaveBeenCalled();
      expect(mock.mark).not.toHaveBeenCalled();
    },
  );
  it.each(['?actorId=other', '?readAt=now', '?unused='])(
    'disallows every read receipt query string %s',
    async (search) => {
      const ctx = context();
      mock.context.mockReturnValue(ctx);
      expect(
        (
          await chatReadPost(
            post({}, origin, 'application/json', search),
            slug,
            messageId,
          )
        ).status,
      ).toBe(400);
      expect(ctx.port.verifySubject).not.toHaveBeenCalled();
      expect(mock.mark).not.toHaveBeenCalled();
    },
  );
  it.each([
    [{ actorId: actor }, 'application/json'],
    [{ readAt: 'now' }, 'application/json'],
    [{ readCount: 50 }, 'application/json'],
    [{ slug, messageId }, 'application/json'],
    [[], 'application/json'],
    [null, 'application/json'],
    ['not-json', 'application/json'],
    ['{"x":', 'application/json'],
    ['{}', 'text/plain'],
    [' '.repeat(CHAT_BODY_LIMIT + 1), 'application/json'],
  ])(
    'rejects body-selected fields and malformed receipt body %j',
    async (body, type) => {
      expect(
        (await chatReadPost(post(body, origin, type), slug, messageId)).status,
      ).toBe(400);
      expect(mock.readPort).not.toHaveBeenCalled();
      expect(mock.mark).not.toHaveBeenCalled();
    },
  );
});

describe.each(['get', 'read'] as const)(
  'chat %s authenticated fan gate',
  (kind) => {
    const invoke = () =>
      kind === 'get'
        ? chatMessagesGet(get(), slug)
        : chatReadPost(post(), slug, messageId);
    it.each(['client', 'port', 'configuration'] as const)(
      'fails closed when %s is unconfigured',
      async (key) => {
        mock.context.mockReturnValue({ ...context(), [key]: null });
        const response = await invoke();
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
          ok: false,
          code: 'SETUP_NOT_READY',
        });
        expect(mock.page).not.toHaveBeenCalled();
        expect(mock.mark).not.toHaveBeenCalled();
      },
    );
    it('requires a verified session and does not use unverified cookies as subject', async () => {
      const ctx = context();
      ctx.port.verifySubject.mockResolvedValue({ ok: true, data: null });
      mock.context.mockReturnValue(ctx);
      const response = await invoke();
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        ok: false,
        code: 'UNAUTHENTICATED',
      });
      expect(ctx.port.readProfile).not.toHaveBeenCalled();
      expect(mock.page).not.toHaveBeenCalled();
      expect(mock.mark).not.toHaveBeenCalled();
    });
    it('does not relabel an Auth outage as successful anonymous access', async () => {
      const ctx = context();
      ctx.port.verifySubject.mockResolvedValue({
        ok: false,
        code: 'UNAVAILABLE',
      });
      mock.context.mockReturnValue(ctx);
      const response = await invoke();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
    });
    it.each(['artist', 'admin'])(
      'denies a current %s role even with a valid session',
      async (role) => {
        mock.context.mockReturnValue(context(role));
        expect((await invoke()).status).toBe(403);
        expect(mock.page).not.toHaveBeenCalled();
        expect(mock.mark).not.toHaveBeenCalled();
      },
    );
    it('requires completed onboarding before paid feed/read operations', async () => {
      const ctx = context();
      const base = (await ctx.port.readProfile()).data;
      ctx.port.readProfile.mockResolvedValue({
        ok: true,
        data: { ...base, onboarding_completed_at: null },
      });
      mock.context.mockReturnValue(ctx);
      const response = await invoke();
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        ok: false,
        code: 'PROFILE_REQUIRED',
      });
      expect(mock.page).not.toHaveBeenCalled();
      expect(mock.mark).not.toHaveBeenCalled();
    });
    it('denies current restricted profiles independently of claimed subscription', async () => {
      const ctx = context();
      const base = (await ctx.port.readProfile()).data;
      ctx.port.readProfile.mockResolvedValue({
        ok: true,
        data: { ...base, is_restricted: true, restricted_until: null },
      });
      mock.context.mockReturnValue(ctx);
      expect((await invoke()).status).toBe(403);
      expect(mock.page).not.toHaveBeenCalled();
      expect(mock.mark).not.toHaveBeenCalled();
    });
    it.each(Object.entries(CHAT_ERROR_STATUS))(
      'preserves safe service error %s with status %s',
      async (code, status) => {
        (kind === 'get' ? mock.page : mock.mark).mockResolvedValue({
          ok: false,
          code,
        });
        const response = await invoke();
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ ok: false, code });
        expect(response.headers.get('cache-control')).toContain('no-store');
      },
    );
  },
);
