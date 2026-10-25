// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { scheduleHttp } from '@/server/schedules/http';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { SCHEDULE_ERROR_STATUS } from '@/config/schedules';
import {
  scheduleId,
  scheduleEvent,
  adminSchedule,
  scheduleSave,
} from './schedules-fixtures';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  session: vi.fn(),
  port: vi.fn(),
  artists: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  myArtists: vi.fn(),
  adminList: vi.fn(),
  adminDetail: vi.fn(),
  save: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mocks.session,
}));
vi.mock('@/server/db/schedules', () => ({ createSchedulePort: mocks.port }));
vi.mock('@/server/db/admin-artists', () => ({
  createAdminArtistPort: () => ({ list: mocks.artists }),
}));
function request(
  query = '?month=2026-10',
  method = 'GET',
  body?: unknown,
  origin: string | null = 'https://app.example',
) {
  return new NextRequest(`https://app.example/api/schedules${query}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      'content-type': 'application/json',
      ...(origin ? { origin } : {}),
    },
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockReturnValue({
    configuration: { appOrigin: 'https://app.example' },
    client: {},
    port: {},
    apply: (r: Response) => {
      Object.entries(AUTH_PRIVATE_HEADERS).forEach(([k, v]) =>
        r.headers.set(k, v),
      );
      return r;
    },
  });
  mocks.session.mockResolvedValue({
    status: 'authenticated',
    profile: {
      id: scheduleId,
      role: 'admin',
      is_restricted: false,
      onboarding_completed_at: '2026-01-01',
    },
  });
  mocks.port.mockReturnValue(mocks);
  mocks.artists.mockResolvedValue({
    ok: true,
    data: { artists: [], has_more: false },
  });
  mocks.list.mockResolvedValue({ ok: true, data: [scheduleEvent] });
  mocks.myArtists.mockResolvedValue({ ok: true, data: [] });
  mocks.detail.mockResolvedValue({ ok: true, data: scheduleEvent });
  mocks.adminDetail.mockResolvedValue({ ok: true, data: adminSchedule });
  mocks.adminList.mockResolvedValue({
    ok: true,
    data: {
      month: '2026-10',
      page: 1,
      page_size: 30,
      has_more: false,
      items: [adminSchedule],
    },
  });
  mocks.save.mockResolvedValue({ ok: true, data: adminSchedule });
  mocks.delete.mockResolvedValue({
    ok: true,
    data: { id: scheduleId, deleted: true },
  });
});
it('fan list has private no-store headers and fresh own-filter RPC', async () => {
  const r = await scheduleHttp(request(), 'fan');
  expect(r.status).toBe(200);
  expect((await r.json()).data.items).toEqual([scheduleEvent]);
  expect(mocks.myArtists).toHaveBeenCalledOnce();
  for (const [k, v] of Object.entries(AUTH_PRIVATE_HEADERS))
    expect(r.headers.get(k)).toBe(v);
  expect(r.headers.get('x-content-type-options')).toBe('nosniff');
});
it('admin list and fan/admin detail route to matching data boundary', async () => {
  expect((await scheduleHttp(request(), 'admin')).status).toBe(200);
  expect(mocks.adminList).toHaveBeenCalledExactlyOnceWith({
    month: '2026-10',
    page: 1,
  });
  expect((await scheduleHttp(request(`?id=${scheduleId}`), 'fan')).status).toBe(
    200,
  );
  expect(mocks.detail).toHaveBeenCalledExactlyOnceWith(scheduleId);
  expect(
    (await scheduleHttp(request(`?id=${scheduleId}`), 'admin')).status,
  ).toBe(200);
  expect(mocks.adminDetail).toHaveBeenCalledExactlyOnceWith(scheduleId);
});
it.each([
  '?month=2026-10&month=2026-11',
  '?page=1&page=2',
  '?month=bad',
  '?actor_id=x',
  '?id=bad',
  `?id=${scheduleId}&month=2026-10`,
  '?month=2026-10&cursor=bad',
])('rejects malformed fan query %s', async (query) => {
  expect((await scheduleHttp(request(query), 'fan')).status).toBe(400);
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.detail).not.toHaveBeenCalled();
});
it.each(['?page=0', '?page=1001', '?cursor=x', '?unknown=x'])(
  'rejects malformed admin query %s',
  async (query) =>
    expect((await scheduleHttp(request(query), 'admin')).status).toBe(400),
);
it.each(['fan', 'artist'])(
  'rejects non-admin %s for all admin operations',
  async (role) => {
    mocks.session.mockResolvedValue({
      status: 'authenticated',
      profile: { role, onboarding_completed_at: '2026-01-01' },
    });
    for (const action of ['admin', 'save', 'delete'] as const)
      expect(
        (
          await scheduleHttp(
            request(
              '',
              action === 'admin' ? 'GET' : 'POST',
              action === 'admin' ? undefined : scheduleSave,
            ),
            action,
          )
        ).status,
      ).toBe(403);
    expect(mocks.port).not.toHaveBeenCalled();
  },
);
it('allows onboarded fan public schedule read without subscription gate', async () => {
  mocks.session.mockResolvedValue({
    status: 'authenticated',
    profile: { role: 'fan', onboarding_completed_at: '2026-01-01' },
  });
  expect((await scheduleHttp(request(), 'fan')).status).toBe(200);
});
it.each([
  { role: 'admin', is_restricted: true },
  { role: 'fan', onboarding_completed_at: null },
])('rejects restricted or unready actor %#', async (profile) => {
  mocks.session.mockResolvedValue({ status: 'authenticated', profile });
  expect((await scheduleHttp(request(), 'fan')).status).toBe(403);
  expect(mocks.port).not.toHaveBeenCalled();
});
it.each([
  ['anonymous', 401],
  ['unavailable', 503],
  ['unconfigured', 401],
])('sanitizes auth state %s', async (status, http) => {
  mocks.session.mockResolvedValue({ status });
  expect((await scheduleHttp(request(), 'fan')).status).toBe(http);
  expect(mocks.port).not.toHaveBeenCalled();
});
it('fails honest setup state without a backend', async () => {
  mocks.context.mockReturnValue({
    configuration: null,
    client: null,
    port: null,
    apply: (r: Response) => r,
  });
  expect((await scheduleHttp(request(), 'fan')).status).toBe(503);
});
it.each([null, 'https://evil.example', 'null', 'https://app.example.evil'])(
  'denies unsafe mutation Origin %s',
  async (origin) => {
    expect(
      (await scheduleHttp(request('', 'POST', scheduleSave, origin), 'save'))
        .status,
    ).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  },
);
it('passes exact validated save payload without actor override', async () => {
  expect(
    (await scheduleHttp(request('', 'POST', scheduleSave), 'save')).status,
  ).toBe(200);
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(scheduleSave);
  expect(
    (
      await scheduleHttp(
        request('', 'POST', { ...scheduleSave, actor_id: scheduleId }),
        'save',
      )
    ).status,
  ).toBe(400);
});
it('enforces methods and no mutation query strings', async () => {
  expect((await scheduleHttp(request('', 'POST', {}), 'fan')).status).toBe(400);
  expect((await scheduleHttp(request('', 'GET'), 'save')).status).toBe(400);
  expect(
    (await scheduleHttp(request('?id=x', 'POST', scheduleSave), 'save')).status,
  ).toBe(400);
});
it.each(Object.entries(SCHEDULE_ERROR_STATUS))(
  'maps exact service code %s',
  async (code, status) => {
    mocks.detail.mockResolvedValue({ ok: false, code });
    expect(
      (await scheduleHttp(request(`?id=${scheduleId}`), 'fan')).status,
    ).toBe(status);
  },
);
it('does not leak session exceptions', async () => {
  mocks.session.mockRejectedValue(new Error('private credential'));
  expect(await (await scheduleHttp(request(), 'fan')).json()).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});

it('binds every screen request to its mounted actor without treating it as authorization', async () => {
  const req = request();
  req.headers.set('X-Schedule-Actor', scheduleId);
  expect((await scheduleHttp(req, 'fan')).status).toBe(200);
  for (const action of ['fan', 'admin', 'save', 'delete'] as const) {
    const req = request(
      '',
      action === 'fan' || action === 'admin' ? 'GET' : 'POST',
      action === 'save' ? scheduleSave : undefined,
    );
    req.headers.set('X-Schedule-Actor', '00000000-0000-4000-8000-000000000099');
    expect((await scheduleHttp(req, action)).status).toBe(403);
  }
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.delete).not.toHaveBeenCalled();
});
it('schedule artist picker uses current administrator plus mounted actor binding', async () => {
  const req = request('?artists=1&page=2');
  req.headers.set('X-Schedule-Actor', scheduleId);
  const result = await scheduleHttp(req, 'admin');
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({
    ok: true,
    data: { artists: [], has_more: false },
  });
  expect(mocks.artists).toHaveBeenCalledExactlyOnceWith(2);
});
it.each([
  '?artists=0',
  '?artists=1&id=' + scheduleId,
  '?artists=1&month=2026-10',
  '?artists=1&page=1001',
])('rejects invalid artist picker query %s', async (query) => {
  expect((await scheduleHttp(request(query), 'admin')).status).toBe(400);
  expect(mocks.artists).not.toHaveBeenCalled();
});
it('sanitizes unsupported artist picker error and keeps current authority failures', async () => {
  mocks.artists
    .mockResolvedValueOnce({ ok: false, code: 'SLUG_CONFLICT' })
    .mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
  expect(
    await (await scheduleHttp(request('?artists=1'), 'admin')).json(),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect((await scheduleHttp(request('?artists=1'), 'admin')).status).toBe(403);
});
