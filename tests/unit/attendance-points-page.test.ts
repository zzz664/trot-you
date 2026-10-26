// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { getAttendancePointsPage } from '@/server/attendance-points/page';
import { routes } from '@/config/routes';
import { pointsActor } from './attendance-points-fixtures';
const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  context: vi.fn(),
  session: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mocks.session,
}));
function state(extra = {}) {
  return {
    status: 'authenticated',
    profile: {
      id: pointsActor,
      role: 'fan',
      is_restricted: false,
      restricted_until: null,
      onboarding_completed_at: '2026-01-01T00:00:00Z',
      ...extra,
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.cookies.mockResolvedValue({ getAll: () => [] });
  mocks.context.mockReturnValue({ client: {}, port: {} });
  mocks.session.mockResolvedValue(state());
  mocks.redirect.mockImplementation((path) => {
    throw new Error(`redirect:${path}`);
  });
});
it('returns only identity and never balance/history through RSC', async () =>
  expect(await getAttendancePointsPage()).toEqual({
    ok: true,
    data: { key: pointsActor },
  }));
it.each(['artist', 'admin'])(
  'permits unrestricted current %s without fan onboarding',
  async (role) => {
    mocks.session.mockResolvedValue(
      state({ role, onboarding_completed_at: null }),
    );
    expect(await getAttendancePointsPage()).toEqual({
      ok: true,
      data: { key: pointsActor },
    });
  },
);
it('redirects anonymous to login', async () => {
  mocks.session.mockResolvedValue({ status: 'anonymous' });
  await expect(getAttendancePointsPage()).rejects.toThrow(
    `redirect:${routes.start}`,
  );
});
it('redirects incomplete fan to onboarding', async () => {
  mocks.session.mockResolvedValue(state({ onboarding_completed_at: null }));
  await expect(getAttendancePointsPage()).rejects.toThrow(
    `redirect:${routes.onboarding}`,
  );
});
it.each([
  ['unconfigured', 'SETUP_NOT_READY'],
  ['unavailable', 'UNAVAILABLE'],
])('fails closed for %s', async (status, code) => {
  mocks.session.mockResolvedValue({ status });
  expect(await getAttendancePointsPage()).toEqual({ ok: false, code });
});
it('missing client cannot produce usable identity', async () => {
  mocks.context.mockReturnValue({ client: null, port: {} });
  expect(await getAttendancePointsPage()).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it.each([null, '2099-01-01T00:00:00Z', 'bad'])(
  'rejects active or unknown restriction %s',
  async (restricted_until) => {
    mocks.session.mockResolvedValue(
      state({ is_restricted: true, restricted_until }),
    );
    expect(await getAttendancePointsPage()).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
  },
);
it('accepts expired restriction without profile mutation', async () => {
  mocks.session.mockResolvedValue(
    state({ is_restricted: true, restricted_until: '2000-01-01T00:00:00Z' }),
  );
  expect(await getAttendancePointsPage()).toEqual({
    ok: true,
    data: { key: pointsActor },
  });
});
