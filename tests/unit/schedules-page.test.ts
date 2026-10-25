// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { getSchedulePage } from '@/server/schedules/page';
import { routes } from '@/config/routes';
import { scheduleId } from './schedules-fixtures';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  session: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [] }),
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mocks.session,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockReturnValue({ client: {}, port: {} });
  mocks.session.mockResolvedValue({
    status: 'authenticated',
    profile: {
      id: scheduleId,
      role: 'fan',
      onboarding_completed_at: '2026-01-01',
    },
  });
  mocks.redirect.mockImplementation(() => {
    throw new Error('redirect');
  });
});
it('RSC carries mount key and safe fan hint, never private subscription/draft snapshots', async () =>
  expect(await getSchedulePage()).toEqual({
    ok: true,
    data: { key: scheduleId, canConfigureNotices: true },
  }));
it('signed-out user is redirected without exposing a cached event', async () => {
  mocks.session.mockResolvedValue({ status: 'anonymous' });
  await expect(getSchedulePage()).rejects.toThrow('redirect');
  expect(mocks.redirect).toHaveBeenCalledWith(routes.start);
});
it('onboarding prerequisites are enforced for fan schedule routes', async () => {
  mocks.session.mockResolvedValue({
    status: 'authenticated',
    profile: { id: scheduleId, role: 'fan', onboarding_completed_at: null },
  });
  await expect(getSchedulePage()).rejects.toThrow('redirect');
  expect(mocks.redirect).toHaveBeenCalledWith(routes.onboarding);
});
it.each(['fan', 'artist'])(
  'non-admin %s cannot mount admin data boundary',
  async (role) => {
    mocks.session.mockResolvedValue({
      status: 'authenticated',
      profile: { id: scheduleId, role },
    });
    expect(await getSchedulePage(true)).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
  },
);
it('current admin can mount schedule management only after live session read', async () => {
  mocks.session.mockResolvedValue({
    status: 'authenticated',
    profile: { id: scheduleId, role: 'admin' },
  });
  expect(await getSchedulePage(true)).toEqual({
    ok: true,
    data: { key: scheduleId, canConfigureNotices: false },
  });
  expect(mocks.session).toHaveBeenCalledOnce();
});
it.each(['fan', 'artist', 'admin'])(
  'restricted %s cannot mount schedule UI',
  async (role) => {
    mocks.session.mockResolvedValue({
      status: 'authenticated',
      profile: {
        id: scheduleId,
        role,
        is_restricted: true,
        restricted_until: null,
      },
    });
    expect(await getSchedulePage()).toEqual({ ok: false, code: 'FORBIDDEN' });
  },
);
it.each(['unavailable', 'unconfigured'])(
  'reports honest %s without fake success',
  async (status) => {
    mocks.session.mockResolvedValue({ status });
    expect(await getSchedulePage()).toEqual({
      ok: false,
      code: status === 'unconfigured' ? 'SETUP_NOT_READY' : 'UNAVAILABLE',
    });
  },
);

it.each(['artist', 'admin'])(
  'valid %s can view public schedules without fan-only controls',
  async (role) => {
    mocks.session.mockResolvedValue({
      status: 'authenticated',
      profile: { id: scheduleId, role },
    });
    expect(await getSchedulePage()).toEqual({
      ok: true,
      data: { key: scheduleId, canConfigureNotices: false },
    });
  },
);
