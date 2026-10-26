// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { getCommunityModerationPage } from '@/server/community-moderation/page';
import { routes } from '@/config/routes';
import { moderationActor } from './community-moderation-fixtures';
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
      id: moderationActor,
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
it('returns identity alone without private report data or policy', async () =>
  expect(await getCommunityModerationPage()).toEqual({
    ok: true,
    data: { key: moderationActor },
  }));
it('requires admin for admin page', async () =>
  expect(await getCommunityModerationPage(true)).toEqual({
    ok: false,
    code: 'FORBIDDEN',
  }));
it('allows current unrestricted admin without fan onboarding', async () => {
  mocks.session.mockResolvedValue(
    state({ role: 'admin', onboarding_completed_at: null }),
  );
  expect(await getCommunityModerationPage(true)).toEqual({
    ok: true,
    data: { key: moderationActor },
  });
});
it.each(['fan', 'artist'])('rejects %s admin page access', async (role) => {
  mocks.session.mockResolvedValue(state({ role }));
  expect(await getCommunityModerationPage(true)).toEqual({
    ok: false,
    code: 'FORBIDDEN',
  });
});
it('redirects anonymous session to login', async () => {
  mocks.session.mockResolvedValue({ status: 'anonymous' });
  await expect(getCommunityModerationPage()).rejects.toThrow(
    `redirect:${routes.start}`,
  );
});
it('redirects incomplete fan to onboarding', async () => {
  mocks.session.mockResolvedValue(state({ onboarding_completed_at: null }));
  await expect(getCommunityModerationPage()).rejects.toThrow(
    `redirect:${routes.onboarding}`,
  );
});
it.each([
  ['unconfigured', 'SETUP_NOT_READY'],
  ['unavailable', 'UNAVAILABLE'],
] as const)('fails closed for %s session', async (status, code) => {
  mocks.session.mockResolvedValue({ status });
  expect(await getCommunityModerationPage()).toEqual({ ok: false, code });
});
it('missing actor client never produces usable identity', async () => {
  mocks.context.mockReturnValue({ client: null, port: {} });
  expect(await getCommunityModerationPage()).toEqual({
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
    expect(await getCommunityModerationPage()).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
  },
);
it('expired restriction permits current identity', async () => {
  mocks.session.mockResolvedValue(
    state({ is_restricted: true, restricted_until: '2000-01-01T00:00:00Z' }),
  );
  expect(await getCommunityModerationPage()).toEqual({
    ok: true,
    data: { key: moderationActor },
  });
});
