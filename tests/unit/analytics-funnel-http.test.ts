// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import {
  ANALYTICS_FUNNEL,
  ANALYTICS_FUNNEL_ERROR_STATUS,
} from '@/config/analytics-funnel';
import { analyticsFunnelHttp } from '@/server/analytics-funnel/http';
import * as f from './analytics-funnel-fixtures';
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
vi.mock('@/server/db/analytics-funnel', () => ({
  createAnalyticsFunnelPort: mocks.port,
}));
function state(extra = {}) {
  return {
    status: 'authenticated',
    profile: {
      id: f.funnelActor,
      role: 'admin',
      is_restricted: false,
      restricted_until: null,
      onboarding_completed_at: null,
      ...extra,
    },
  };
}
function context() {
  return {
    configuration: { appOrigin: 'https://app.example' },
    client: {},
    port: {},
    apply: (r: Response) => {
      for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
        r.headers.set(key, value);
      return r;
    },
  };
}
function request(
  options: { method?: string; query?: string; actor?: string | null } = {},
) {
  return new NextRequest(
    `https://app.example/api/admin/analytics${options.query ?? '?from=2026-10-01&to=2026-10-25'}`,
    {
      method: options.method ?? 'GET',
      headers:
        options.actor === null
          ? {}
          : { [ANALYTICS_FUNNEL.actorHeader]: options.actor ?? f.funnelActor },
    },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockReturnValue(context());
  mocks.session.mockResolvedValue(state());
  mocks.port.mockReturnValue({ read: mocks.read });
  mocks.read.mockResolvedValue({ ok: true, data: f.funnelDashboard });
});
it('checks current admin, expected actor and query with private headers', async () => {
  const r = await analyticsFunnelHttp(request());
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ ok: true, data: f.funnelDashboard });
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(f.funnelQuery);
  for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
    expect(r.headers.get(key)).toBe(value);
  expect(r.headers.get('vary')).toBe(`Cookie, ${ANALYTICS_FUNNEL.actorHeader}`);
  expect(r.headers.get('x-content-type-options')).toBe('nosniff');
});
it.each([f.funnelOther, 'bad', null])(
  'rejects missing/wrong actor %#',
  async (actor) => {
    expect((await analyticsFunnelHttp(request({ actor }))).status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
  },
);
it.each([
  { role: 'fan' },
  { role: 'artist' },
  { is_restricted: true, restricted_until: null },
  { is_restricted: true, restricted_until: '2099-01-01T00:00:00Z' },
  { is_restricted: true, restricted_until: 'bad' },
])('rejects current role/restriction %#', async (extra) => {
  mocks.session.mockResolvedValue(state(extra));
  expect((await analyticsFunnelHttp(request())).status).toBe(403);
  expect(mocks.read).not.toHaveBeenCalled();
});
it('expired restriction is read without profile mutation', async () => {
  mocks.session.mockResolvedValue(
    state({ is_restricted: true, restricted_until: '2000-01-01T00:00:00Z' }),
  );
  expect((await analyticsFunnelHttp(request())).status).toBe(200);
});
it.each([
  ['anonymous', 401],
  ['unconfigured', 401],
  ['unavailable', 503],
] as const)('denies %s', async (status, code) => {
  mocks.session.mockResolvedValue({ status });
  expect((await analyticsFunnelHttp(request())).status).toBe(code);
  expect(mocks.read).not.toHaveBeenCalled();
});
it.each(['configuration', 'client', 'port'])(
  'missing %s is setup unavailable',
  async (key) => {
    mocks.context.mockReturnValue({ ...context(), [key]: null });
    expect((await analyticsFunnelHttp(request())).status).toBe(503);
    expect(mocks.session).not.toHaveBeenCalled();
  },
);
it.each(['POST', 'PATCH', 'PUT', 'DELETE', 'HEAD'])(
  'rejects %s without writes',
  async (method) => {
    expect((await analyticsFunnelHttp(request({ method }))).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
  },
);
it.each([
  '?user_id=x',
  '?from=2026-10-01&from=2026-10-02&to=2026-10-25',
  '?from=bad&to=2026-10-25',
  '?from=2026-10-01',
  '?to=2026-10-25',
  '?from=2026-10-01&to=2099-10-25',
  '?from=&to=',
])('rejects invalid query %s', async (query) => {
  expect((await analyticsFunnelHttp(request({ query }))).status).toBe(400);
  expect(mocks.read).not.toHaveBeenCalled();
});
it.each(Object.entries(ANALYTICS_FUNNEL_ERROR_STATUS))(
  'preserves %s/status pair privately',
  async (code, status) => {
    mocks.read.mockResolvedValue({ ok: false, code });
    const r = await analyticsFunnelHttp(request());
    expect(r.status).toBe(status);
    expect(await r.json()).toEqual({ ok: false, code });
    expect(r.headers.get('cache-control')).toBe(
      AUTH_PRIVATE_HEADERS['Cache-Control'],
    );
  },
);
it.each(['session', 'read'] as const)(
  'conceals thrown %s details',
  async (method) => {
    mocks[method].mockRejectedValue(new Error('private SQL/auth'));
    const r = await analyticsFunnelHttp(request());
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  },
);
it('wrong account output cannot become success', async () => {
  mocks.read.mockResolvedValue({
    ok: true,
    data: { ...f.funnelDashboard, actor_id: f.funnelOther },
  });
  expect((await analyticsFunnelHttp(request())).status).toBe(503);
});
it('passes cookies only into auth context', async () => {
  const r = request();
  r.cookies.set('session', 'opaque');
  await analyticsFunnelHttp(r);
  expect(mocks.context).toHaveBeenCalledExactlyOnceWith([
    { name: 'session', value: 'opaque' },
  ]);
});
