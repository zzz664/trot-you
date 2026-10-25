// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { getCommunityPostsPage } from '@/server/community-posts/page';
import { routes } from '@/config/routes';
import { boardActorId } from './community-posts-fixtures';
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
function session(role = 'fan', extra = {}) {
  return {
    status: 'authenticated',
    profile: {
      id: boardActorId,
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
it.each(['fan', 'artist', 'admin'])(
  'mounts authorized %s with only account key, no post or media snapshot',
  async (role) => {
    mocks.session.mockResolvedValue(session(role));
    expect(await getCommunityPostsPage()).toEqual({
      ok: true,
      data: { key: boardActorId },
    });
  },
);
it('redirects anonymous to login', async () => {
  mocks.session.mockResolvedValue({ status: 'anonymous' });
  await expect(getCommunityPostsPage()).rejects.toThrow('redirect');
  expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(routes.start);
});
it('redirects incomplete fan to onboarding', async () => {
  mocks.session.mockResolvedValue(
    session('fan', { onboarding_completed_at: null }),
  );
  await expect(getCommunityPostsPage()).rejects.toThrow('redirect');
  expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(routes.onboarding);
});
it.each(['artist', 'admin'])(
  'uses established community actor authorization for %s without inventing fan onboarding requirement',
  async (role) => {
    mocks.session.mockResolvedValue(
      session(role, { onboarding_completed_at: null }),
    );
    expect((await getCommunityPostsPage()).ok).toBe(true);
  },
);
it.each(['fan', 'artist', 'admin'])(
  'denies currently restricted %s',
  async (role) => {
    mocks.session.mockResolvedValue(
      session(role, { is_restricted: true, restricted_until: null }),
    );
    expect(await getCommunityPostsPage()).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
  },
);
it('expired restriction does not impose permanent punishment', async () => {
  mocks.session.mockResolvedValue(
    session('fan', { is_restricted: true, restricted_until: '2000-01-01' }),
  );
  expect((await getCommunityPostsPage()).ok).toBe(true);
});
it.each(['unavailable', 'unconfigured'])(
  'reports honest %s state',
  async (status) => {
    mocks.session.mockResolvedValue({ status });
    expect(await getCommunityPostsPage()).toEqual({
      ok: false,
      code: status === 'unconfigured' ? 'SETUP_NOT_READY' : 'UNAVAILABLE',
    });
  },
);
it('missing client cannot manufacture ready board', async () => {
  mocks.context.mockReturnValue({ client: null, port: {} });
  expect(await getCommunityPostsPage()).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
