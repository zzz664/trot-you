// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { billingNoticeHttp } from '@/server/billing-notices/http';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { routes } from '@/config/routes';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  session: vi.fn(),
  port: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  preference: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mocks.session,
}));
vi.mock('@/server/db/billing-notices', () => ({
  createBillingNoticePort: mocks.port,
}));
vi.mock('@/server/services/billing-notices/notices', () => ({
  listBillingNotices: mocks.list,
  markBillingNoticeRead: mocks.read,
  setBillingNoticePreference: mocks.preference,
}));
const id = '00000000-0000-4000-8000-000000000001';
function request(
  method = 'GET',
  query = '',
  body?: string,
  origin: string | null = 'https://app.example',
) {
  const headers = new Headers();
  if (origin !== null) headers.set('origin', origin);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new NextRequest(
    `https://app.example${routes.billingNoticeStatus}${query}`,
    { method, headers, ...(body === undefined ? {} : { body }) },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockReturnValue({
    configuration: { appOrigin: 'https://app.example' },
    client: {},
    port: {},
    apply: (response: Response) => {
      Object.entries(AUTH_PRIVATE_HEADERS).forEach(([key, value]) =>
        response.headers.set(key, value),
      );
      return response;
    },
  });
  mocks.session.mockResolvedValue({ status: 'authenticated', profile: { id } });
  mocks.port.mockReturnValue({ fixture: true });
  mocks.list.mockResolvedValue({
    ok: true,
    data: {
      notices: [],
      hasMore: false,
      nextCursor: null,
      billingEnabled: false,
    },
  });
  mocks.read.mockResolvedValue({ ok: true, data: null });
  mocks.preference.mockResolvedValue({
    ok: true,
    data: { billingEnabled: true },
  });
});
it('authenticated list uses only actor DB port and no-store headers', async () => {
  const response = await billingNoticeHttp(request(), 'list');
  expect(response.status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith({ fixture: true }, null);
  for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
    expect(response.headers.get(key)).toBe(value);
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
});
it.each(['?actor=other', '?cursor=a&cursor=b', '?cursor=a&amount=1'])(
  'rejects extra authority and repeated cursor %s',
  async (query) => {
    expect(
      (await billingNoticeHttp(request('GET', query), 'list')).status,
    ).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  },
);
it.each([null, 'https://evil.example', 'null'])(
  'rejects cross-origin mutations %s',
  async (origin) => {
    expect(
      (
        await billingNoticeHttp(
          request('POST', '', JSON.stringify({ noticeId: id }), origin),
          'read',
        )
      ).status,
    ).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
  },
);
it.each(['anonymous', 'unavailable'])(
  'fails current Auth state closed %s',
  async (status) => {
    mocks.session.mockResolvedValue({ status });
    expect((await billingNoticeHttp(request(), 'list')).status).toBe(
      status === 'anonymous' ? 401 : 503,
    );
    expect(mocks.port).not.toHaveBeenCalled();
  },
);
it('marks owner read with bounded JSON and no supplied delivery evidence', async () => {
  expect(
    (
      await billingNoticeHttp(
        request('POST', '', JSON.stringify({ noticeId: id })),
        'read',
      )
    ).status,
  ).toBe(200);
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(
    { fixture: true },
    { noticeId: id },
  );
  expect(mocks.preference).not.toHaveBeenCalled();
});
it('updates billing preference through separate explicit action', async () => {
  expect(
    (
      await billingNoticeHttp(
        request('POST', '', JSON.stringify({ enabled: true })),
        'preference',
      )
    ).status,
  ).toBe(200);
  expect(mocks.preference).toHaveBeenCalledExactlyOnceWith(
    { fixture: true },
    { enabled: true },
  );
  expect(mocks.read).not.toHaveBeenCalled();
});
it('redacts dependency exceptions', async () => {
  mocks.list.mockRejectedValue(new Error('private price/token'));
  const response = await billingNoticeHttp(request(), 'list');
  expect(await response.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('requires auth configuration, independent of worker/provider configuration', async () => {
  mocks.context.mockReturnValue({
    configuration: null,
    client: null,
    port: null,
    apply: (r: Response) => r,
  });
  expect((await billingNoticeHttp(request(), 'list')).status).toBe(503);
  expect(mocks.session).not.toHaveBeenCalled();
});
