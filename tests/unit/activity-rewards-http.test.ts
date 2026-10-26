// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { ACTIVITY_REWARDS } from '@/config/activity-rewards';
import { POINTS_ERROR_STATUS } from '@/config/attendance-points';
import { activityRewardsHttp } from '@/server/activity-rewards/http';
import * as f from './activity-rewards-fixtures';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  session: vi.fn(),
  port: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mocks.session,
}));
vi.mock('@/server/db/activity-rewards', () => ({
  createActivityRewardsPort: mocks.port,
}));
function state(extra = {}) {
  return {
    status: 'authenticated',
    profile: {
      id: f.activityActor,
      role: 'fan',
      is_restricted: false,
      restricted_until: null,
      onboarding_completed_at: '2026-01-01T00:00:00Z',
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
    `https://app.example/api/points/activity${options.query ?? ''}`,
    {
      method: options.method ?? 'GET',
      headers:
        options.actor === null
          ? {}
          : {
              [ACTIVITY_REWARDS.actorHeader]: options.actor ?? f.activityActor,
            },
    },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockReturnValue(context());
  mocks.session.mockResolvedValue(state());
  mocks.port.mockReturnValue({ snapshot: mocks.snapshot });
  mocks.snapshot.mockResolvedValue({ ok: true, data: f.activitySnapshot });
});
it('reads with fresh identity and no-cache/nosniff headers, without write-origin requirements', async () => {
  const response = await activityRewardsHttp(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, data: f.activitySnapshot });
  for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
    expect(response.headers.get(key)).toBe(value);
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('vary')).toBe(
    `Cookie, ${ACTIVITY_REWARDS.actorHeader}`,
  );
  expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith(null);
});
it.each([f.activityOther, 'bad', null])(
  'denies absent/wrong expected actor %#',
  async (actor) => {
    expect((await activityRewardsHttp(request({ actor }))).status).toBe(403);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  },
);
it.each([
  { is_restricted: true, restricted_until: null },
  { is_restricted: true, restricted_until: '2099-01-01T00:00:00Z' },
  { is_restricted: true, restricted_until: 'bad' },
  { onboarding_completed_at: null },
])('denies restriction/incomplete fan onboarding %#', async (extra) => {
  mocks.session.mockResolvedValue(state(extra));
  expect((await activityRewardsHttp(request())).status).toBe(403);
  expect(mocks.snapshot).not.toHaveBeenCalled();
});
it.each(['artist', 'admin'])(
  'allows current unrestricted %s without fan onboarding',
  async (role) => {
    mocks.session.mockResolvedValue(
      state({ role, onboarding_completed_at: null }),
    );
    expect((await activityRewardsHttp(request())).status).toBe(200);
  },
);
it('allows expired restriction without changing the account', async () => {
  mocks.session.mockResolvedValue(
    state({ is_restricted: true, restricted_until: '2000-01-01T00:00:00Z' }),
  );
  expect((await activityRewardsHttp(request())).status).toBe(200);
});
it.each([
  ['anonymous', 401],
  ['unconfigured', 401],
  ['unavailable', 503],
] as const)('denies %s session', async (status, expected) => {
  mocks.session.mockResolvedValue({ status });
  expect((await activityRewardsHttp(request())).status).toBe(expected);
  expect(mocks.snapshot).not.toHaveBeenCalled();
});
it.each(['configuration', 'client', 'port'])(
  'fails closed without %s',
  async (key) => {
    mocks.context.mockReturnValue({ ...context(), [key]: null });
    expect((await activityRewardsHttp(request())).status).toBe(503);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.snapshot).not.toHaveBeenCalled();
  },
);
it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])(
  'rejects %s instead of creating claim semantics',
  async (method) => {
    expect((await activityRewardsHttp(request({ method }))).status).toBe(400);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.snapshot).not.toHaveBeenCalled();
  },
);
it.each([
  '?actor_id=other',
  '?amount=99',
  '?share_verified=true',
  '?cursor=a&cursor=b',
  '?cursor=',
  '?cursor=%7B',
])('rejects unsupported or malformed query %s', async (query) => {
  expect((await activityRewardsHttp(request({ query }))).status).toBe(400);
  expect(mocks.snapshot).not.toHaveBeenCalled();
});
it('forwards exact cursor through the service without precision truncation', async () => {
  const cursor = {
    id: f.activityEntry.id,
    created_at: '2026-10-26T06:00:00.123457Z',
  };
  expect(
    (
      await activityRewardsHttp(
        request({
          query: `?${new URLSearchParams({ cursor: JSON.stringify(cursor) })}`,
        }),
      )
    ).status,
  ).toBe(200);
  expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith(cursor);
});
it.each(Object.entries(POINTS_ERROR_STATUS))(
  'returns safe %s error/status pair privately',
  async (code, status) => {
    mocks.snapshot.mockResolvedValue({ ok: false, code });
    const response = await activityRewardsHttp(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, code });
    expect(response.headers.get('cache-control')).toBe(
      AUTH_PRIVATE_HEADERS['Cache-Control'],
    );
  },
);
it.each(['session', 'snapshot'] as const)(
  'conceals thrown %s details',
  async (method) => {
    mocks[method].mockRejectedValue(new Error('private SQL/auth detail'));
    const response = await activityRewardsHttp(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  },
);
it('rejects mismatched actor output after the authenticated read', async () => {
  mocks.snapshot.mockResolvedValue({
    ok: true,
    data: { ...f.activitySnapshot, actor_id: f.activityOther },
  });
  const response = await activityRewardsHttp(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('passes cookies through the auth context only', async () => {
  const req = request();
  req.cookies.set('private-session', 'opaque');
  await activityRewardsHttp(req);
  expect(mocks.context).toHaveBeenCalledExactlyOnceWith([
    { name: 'private-session', value: 'opaque' },
  ]);
});
it('displays unconfigured contribution status without awarding or inventing defaults', async () => {
  const data = { ...f.activitySnapshot, contribution_policy: null };
  mocks.snapshot.mockResolvedValue({ ok: true, data });
  expect(await (await activityRewardsHttp(request())).json()).toEqual({
    ok: true,
    data,
  });
});
