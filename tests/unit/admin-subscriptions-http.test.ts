// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { adminSubscriptionHttp } from '@/server/admin-subscriptions/http';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { ADMIN_SUBSCRIPTION_ERROR_STATUS } from '@/config/admin-subscriptions';
import { routes } from '@/config/routes';
import {
  subscriptionActor,
  subscriptionDashboard,
  subscriptionQuery,
} from './admin-subscriptions-fixtures';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  session: vi.fn(),
  port: vi.fn(),
  read: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mocks.session,
}));
vi.mock('@/server/db/admin-subscriptions', () => ({
  createAdminSubscriptionPort: mocks.port,
}));
vi.mock(
  '@/server/services/admin-subscriptions/read',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    getAdminSubscriptionDashboard: mocks.read,
  }),
);
function request(query = '?from=2026-10-01&to=2026-10-25', method = 'GET') {
  return new NextRequest(
    `https://app.example${routes.adminSubscriptionsApi}${query}`,
    { method },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockReturnValue({
    configuration: { appOrigin: 'https://app.example' },
    client: {},
    port: {},
    apply: (response: Response) => {
      Object.entries(AUTH_PRIVATE_HEADERS).forEach(([k, v]) =>
        response.headers.set(k, v),
      );
      return response;
    },
  });
  mocks.session.mockResolvedValue({
    status: 'authenticated',
    profile: { id: subscriptionActor, role: 'admin', is_restricted: false },
  });
  mocks.port.mockReturnValue({ fixture: true });
  mocks.read.mockResolvedValue({ ok: true, data: subscriptionDashboard });
});
it('returns fresh current-admin aggregate only with private no-store headers', async () => {
  const response = await adminSubscriptionHttp(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ok: true,
    data: subscriptionDashboard,
  });
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(
    { fixture: true },
    subscriptionQuery,
  );
  for (const [k, v] of Object.entries(AUTH_PRIVATE_HEADERS))
    expect(response.headers.get(k)).toBe(v);
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
});
it.each([
  '?actor_id=x',
  '?page=1&page=2',
  '?from=2026-10-01&from=2026-10-02&to=2026-10-25',
  '?from=2026-10-01',
  '?page=0',
  '?page=1001',
  '?artist_id=bad',
  '?to=2026-10-25',
  '?from=2026-10-25&to=2026-10-01',
  '?from=9999-01-01&to=9999-01-01',
])('rejects invalid query %s', async (query) => {
  expect((await adminSubscriptionHttp(request(query))).status).toBe(400);
  expect(mocks.read).not.toHaveBeenCalled();
});
it.each(['POST', 'PATCH', 'DELETE'])(
  'rejects %s rather than exposing mutation',
  async (method) => {
    expect((await adminSubscriptionHttp(request('', method))).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
  },
);
it.each(['fan', 'artist'])(
  'rejects current %s role before RPC',
  async (role) => {
    mocks.session.mockResolvedValue({
      status: 'authenticated',
      profile: { role },
    });
    expect((await adminSubscriptionHttp(request())).status).toBe(403);
    expect(mocks.port).not.toHaveBeenCalled();
  },
);
it('rejects current restriction and does not use stale admin claim', async () => {
  mocks.session.mockResolvedValue({
    status: 'authenticated',
    profile: { role: 'admin', is_restricted: true, restricted_until: null },
  });
  expect((await adminSubscriptionHttp(request())).status).toBe(403);
});
it.each([
  ['anonymous', 401],
  ['unavailable', 503],
  ['unconfigured', 401],
])('maps %s without leaking detail', async (status, http) => {
  mocks.session.mockResolvedValue({ status });
  expect((await adminSubscriptionHttp(request())).status).toBe(http);
  expect(mocks.read).not.toHaveBeenCalled();
});
it('fails closed without backend configuration', async () => {
  mocks.context.mockReturnValue({
    client: null,
    port: null,
    configuration: null,
    apply: (r: Response) => r,
  });
  expect((await adminSubscriptionHttp(request())).status).toBe(503);
});
it.each(Object.entries(ADMIN_SUBSCRIPTION_ERROR_STATUS))(
  'maps exact safe error %s',
  async (code, status) => {
    mocks.read.mockResolvedValue({ ok: false, code });
    expect((await adminSubscriptionHttp(request())).status).toBe(status);
  },
);
it('catches session failure without logging credentials or returning raw error', async () => {
  mocks.session.mockRejectedValue(new Error('private credential'));
  expect(await (await adminSubscriptionHttp(request())).json()).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
