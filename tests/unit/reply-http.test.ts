// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { REPLY_ERROR_STATUS, REPLY_BODY_LIMIT } from '@/config/replies';
import { fanRepliesPath } from '@/config/routes';
import { repliesGet, repliesPost } from '@/server/replies/http';

const mock = vi.hoisted(() => ({
  context: vi.fn(),
  port: vi.fn(),
  page: vi.fn(),
  send: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mock.context }));
vi.mock('@/server/db/replies', () => ({ createReplyPort: mock.port }));
vi.mock('@/server/services/replies/replies', () => ({
  readReplyPage: mock.page,
  sendReply: mock.send,
}));
const actor = 'a2000000-0000-4000-8000-000000000001';
const operationId = 'a2000000-0000-4000-8000-000000000002';
const slug = 'fictional-star';
const origin = 'https://app.example';
const body = { operationId, body: '고맙습니다', messageId: null };
const page = {
  slug,
  sendReady: true,
  maxLength: 100,
  replies: [],
  nextCursor: null,
};
const receipt = {
  slug,
  reply: {
    id: actor,
    operationId,
    messageId: null,
    body: body.body,
    blocked: false,
    createdAt: '2026-10-24T00:00:00Z',
  },
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
  return new NextRequest(`${origin}${fanRepliesPath(slug)}${search}`);
}
function post(
  value: unknown = body,
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
    `https://untrusted.example${fanRepliesPath(slug)}${search}`,
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
  mock.port.mockReturnValue({ actorReplyPort: true });
  mock.page.mockResolvedValue({ ok: true, data: page });
  mock.send.mockResolvedValue({ ok: true, data: receipt });
});
describe('reply GET private own-feed', () => {
  it('uses only authenticated actor capability, exact parsed query and private headers', async () => {
    const response = await repliesGet(get('?limit=30&cursor=YWJj'), slug);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: page });
    expect(mock.port).toHaveBeenCalledExactlyOnceWith({
      actorCapability: true,
    });
    expect(mock.page).toHaveBeenCalledExactlyOnceWith(
      { actorReplyPort: true },
      { slug, limit: 30, cursor: 'YWJj' },
    );
    for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
      expect(response.headers.get(key)).toBe(value);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-cookie-applied')).toBe('yes');
  });
  it('omits missing query fields', async () => {
    await repliesGet(get(), slug);
    expect(mock.page).toHaveBeenCalledWith({ actorReplyPort: true }, { slug });
  });
  it.each([
    '?actorId=x',
    '?limit=30&limit=20',
    '?cursor=a&cursor=b',
    '?limit=',
    '?limit=0',
    '?limit=-1',
    '?limit=01',
    '?limit=1.5',
    '?limit=1e2',
    '?limit=Infinity',
    '?limit=+2',
  ])('rejects query %s without DB service call', async (search) => {
    const response = await repliesGet(get(search), slug);
    expect(response.status).toBe(400);
    expect(mock.page).not.toHaveBeenCalled();
  });
});
describe('reply POST origin/body/actor boundary', () => {
  it('passes immutable body fields with URL-owned slug and no actor impersonation', async () => {
    const response = await repliesPost(post(), slug);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: receipt });
    expect(mock.send).toHaveBeenCalledExactlyOnceWith(
      { actorReplyPort: true },
      { ...body, slug },
    );
    expect(response.headers.get('x-cookie-applied')).toBe('yes');
  });
  it.each([
    null,
    'https://other.example',
    'null',
    'https://app.example.evil',
    'https://app.example:444',
    'http://app.example',
    'https://app.example/',
  ])(
    'rejects origin %s regardless of Host or forwarding values',
    async (source) => {
      const response = await repliesPost(post(body, source), slug);
      expect(response.status).toBe(403);
      expect(mock.send).not.toHaveBeenCalled();
      expect(mock.port).not.toHaveBeenCalled();
    },
  );
  it('rejects POST query parameters', async () => {
    const response = await repliesPost(
      post(body, origin, 'application/json', '?body=x'),
      slug,
    );
    expect(response.status).toBe(400);
    expect(mock.send).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    {},
    { ...body, slug: 'other-star' },
    { ...body, actorId: actor },
    { ...body, body: 1 },
    { ...body, operationId: 'bad' },
    { ...body, messageId: 'bad' },
    { ...body, messageId: undefined },
    '{invalid',
    'x'.repeat(REPLY_BODY_LIMIT + 1),
  ])('rejects invalid JSON/schema/body without mutation', async (value) => {
    expect((await repliesPost(post(value), slug)).status).toBe(400);
    expect(mock.send).not.toHaveBeenCalled();
  });
  it.each([
    'text/plain',
    'application/x-www-form-urlencoded',
    'application/jsonp',
    '',
  ])('rejects content type %s', async (type) => {
    expect((await repliesPost(post(body, origin, type), slug)).status).toBe(
      400,
    );
    expect(mock.send).not.toHaveBeenCalled();
  });
  it('does not retry failed/unknown mutations', async () => {
    mock.send.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    expect((await repliesPost(post(), slug)).status).toBe(503);
    expect(mock.send).toHaveBeenCalledTimes(1);
  });
});
describe('both reply operations require a verified current fan session', () => {
  it.each(['GET', 'POST'])(
    'fails %s closed without configuration/client/session adapter',
    async (method) => {
      const c = context();
      mock.context.mockReturnValue({
        ...c,
        configuration: null,
        client: null,
        port: null,
      });
      const response =
        method === 'GET'
          ? await repliesGet(get(), slug)
          : await repliesPost(post(), slug);
      expect(response.status).toBe(503);
      expect(mock.port).not.toHaveBeenCalled();
      expect(mock.page).not.toHaveBeenCalled();
      expect(mock.send).not.toHaveBeenCalled();
    },
  );
  it.each(['artist', 'admin'])(
    'rejects role %s on GET and POST',
    async (role) => {
      mock.context.mockReturnValue(context(role));
      expect((await repliesGet(get(), slug)).status).toBe(403);
      expect((await repliesPost(post(), slug)).status).toBe(403);
      expect(mock.port).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['anonymous', null, 401],
    ['verification-error', { ok: false, code: 'INTERNAL' }, 503],
  ])('rejects %s', async (_, state, status) => {
    const c = context();
    c.port.verifySubject.mockResolvedValue(state ?? { ok: true, data: null });
    mock.context.mockReturnValue(c);
    expect((await repliesGet(get(), slug)).status).toBe(status);
    expect((await repliesPost(post(), slug)).status).toBe(status);
    expect(mock.port).not.toHaveBeenCalled();
  });
  it('rejects profile identity mismatch', async () => {
    const c = context();
    c.port.readProfile.mockResolvedValue({
      ok: true,
      data: { id: operationId },
    });
    mock.context.mockReturnValue(c);
    expect((await repliesGet(get(), slug)).status).toBe(503);
    expect((await repliesPost(post(), slug)).status).toBe(503);
  });
  it.each([null, '2999-01-01T00:00:00Z', 'malformed'])(
    'rejects current restriction %s',
    async (restricted_until) => {
      const c = context();
      c.port.readProfile.mockResolvedValue({
        ok: true,
        data: {
          id: actor,
          role: 'fan',
          onboarding_completed_at: '2026-10-24T00:00:00Z',
          is_restricted: true,
          restricted_until,
        },
      });
      mock.context.mockReturnValue(c);
      expect((await repliesGet(get(), slug)).status).toBe(403);
      expect((await repliesPost(post(), slug)).status).toBe(403);
    },
  );
  it('requires completed onboarding', async () => {
    const c = context();
    c.port.readProfile.mockResolvedValue({
      ok: true,
      data: {
        id: actor,
        role: 'fan',
        onboarding_completed_at: null,
        is_restricted: false,
      },
    });
    mock.context.mockReturnValue(c);
    expect((await repliesGet(get(), slug)).status).toBe(409);
    expect((await repliesPost(post(), slug)).status).toBe(409);
  });
  it.each(Object.entries(REPLY_ERROR_STATUS))(
    'uses status contract for %s',
    async (code, status) => {
      mock.page.mockResolvedValue({ ok: false, code });
      mock.send.mockResolvedValue({ ok: false, code });
      expect((await repliesGet(get(), slug)).status).toBe(status);
      expect((await repliesPost(post(), slug)).status).toBe(status);
    },
  );
});
