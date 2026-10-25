// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { getContentCalendarPage } from '@/server/content-calendar/page';
import { routes } from '@/config/routes';
import { calendarActorId } from './content-calendar-fixtures';
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
function session(role = 'artist', extra = {}) {
  return {
    status: 'authenticated',
    profile: {
      id: calendarActorId,
      role,
      onboarding_completed_at: '2026-01-01',
      ...extra,
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockReturnValue({ client: {}, port: {} });
  mocks.session.mockResolvedValue(session());
  mocks.redirect.mockImplementation(() => {
    throw new Error('redirect');
  });
});
it('mounts artist route with current actor key only, not a cached private editorial snapshot', async () => {
  expect(await getContentCalendarPage()).toEqual({
    ok: true,
    data: { key: calendarActorId },
  });
  expect(mocks.session).toHaveBeenCalledOnce();
});
it('mounts admin route only after fresh admin session without claiming onboarding completion', async () => {
  mocks.session.mockResolvedValue(
    session('admin', { onboarding_completed_at: null }),
  );
  expect(await getContentCalendarPage(true)).toEqual({
    ok: true,
    data: { key: calendarActorId },
  });
});
it('signed-out user redirects without data', async () => {
  mocks.session.mockResolvedValue({ status: 'anonymous' });
  await expect(getContentCalendarPage()).rejects.toThrow('redirect');
  expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(routes.start);
});
it('artist onboarding remains required', async () => {
  mocks.session.mockResolvedValue(
    session('artist', { onboarding_completed_at: null }),
  );
  await expect(getContentCalendarPage()).rejects.toThrow('redirect');
  expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(routes.onboarding);
});
it.each(['fan', 'admin'])(
  'non-artist %s cannot mount artist data boundary',
  async (role) => {
    mocks.session.mockResolvedValue(session(role));
    expect(await getContentCalendarPage()).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
  },
);
it.each(['fan', 'artist'])(
  'non-admin %s cannot mount admin data boundary',
  async (role) => {
    mocks.session.mockResolvedValue(session(role));
    expect(await getContentCalendarPage(true)).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
  },
);
it.each(['artist', 'admin'])(
  'restricted %s cannot see editorial content',
  async (role) => {
    mocks.session.mockResolvedValue(
      session(role, { is_restricted: true, restricted_until: null }),
    );
    expect(await getContentCalendarPage(role === 'admin')).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
  },
);
it.each(['unavailable', 'unconfigured'])(
  'reports honest configuration/session %s',
  async (status) => {
    mocks.session.mockResolvedValue({ status });
    expect(await getContentCalendarPage()).toEqual({
      ok: false,
      code: status === 'unconfigured' ? 'SETUP_NOT_READY' : 'UNAVAILABLE',
    });
  },
);
it('missing database client cannot produce a successful mount', async () => {
  mocks.context.mockReturnValue({ client: null, port: {} });
  expect(await getContentCalendarPage()).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
