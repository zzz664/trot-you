// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getComposeMenu, getComposePage } from '@/server/artist-compose/page';
import { routes } from '@/config/routes';
const mock = vi.hoisted(() => ({
  cookies: vi.fn(),
  context: vi.fn(),
  session: vi.fn(),
  redirect: vi.fn(),
  port: vi.fn(),
  artists: vi.fn(),
  page: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: mock.cookies }));
vi.mock('next/navigation', () => ({ redirect: mock.redirect }));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mock.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mock.session,
}));
vi.mock('@/server/db/artist-compose', () => ({ createComposePort: mock.port }));
vi.mock('@/server/services/artist-compose/compose', () => ({
  readComposeArtists: mock.artists,
  readComposeContext: mock.page,
}));
const profile = {
  id: 'a3000000-0000-4000-8000-000000000001',
  role: 'artist',
  onboarding_completed_at: '2026-10-24T00:00:00Z',
  is_restricted: false,
  restricted_until: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  mock.cookies.mockResolvedValue({
    getAll: () => [{ name: 'fixture', value: 'private-cookie' }],
  });
  mock.context.mockReturnValue({
    client: { actor: true },
    port: { verified: true },
  });
  mock.session.mockResolvedValue({ status: 'authenticated', profile });
  mock.port.mockReturnValue({ composer: true });
  mock.artists.mockResolvedValue({
    ok: true,
    data: { artists: [], hasMore: false, nextSlug: null },
  });
  mock.page.mockResolvedValue({ ok: true, data: { safe: true } });
  mock.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
});
describe('artist compose server page authorization', () => {
  it.each(['unconfigured', 'anonymous', 'unavailable'])(
    'preserves existing menu redirect for %s session',
    async (status) => {
      mock.session.mockResolvedValue({ status });
      await expect(getComposeMenu(null)).rejects.toThrow(
        `redirect:${routes.start}?next=${encodeURIComponent(routes.artist)}`,
      );
      expect(mock.artists).not.toHaveBeenCalled();
    },
  );
  it('reads current session independently for menu and selected draft without service key', async () => {
    expect((await getComposeMenu(null)).ok).toBe(true);
    expect(mock.artists).toHaveBeenCalledExactlyOnceWith(
      { composer: true },
      null,
    );
    expect((await getComposePage('fictional-star', profile.id)).ok).toBe(true);
    expect(mock.page).toHaveBeenCalledExactlyOnceWith(
      { composer: true },
      { slug: 'fictional-star', messageId: profile.id },
    );
    expect(mock.context).toHaveBeenCalledWith([
      { name: 'fixture', value: 'private-cookie' },
    ]);
  });
  it.each([
    ['fan', routes.home],
    ['admin', routes.admin],
  ])('redirects %s away from artist-only data', async (role, target) => {
    mock.session.mockResolvedValue({
      status: 'authenticated',
      profile: { ...profile, role },
    });
    await expect(getComposePage('fictional-star', null)).rejects.toThrow(
      `redirect:${target}`,
    );
    expect(mock.port).not.toHaveBeenCalled();
  });
  it('redirects current restriction before fetching draft', async () => {
    mock.session.mockResolvedValue({
      status: 'authenticated',
      profile: { ...profile, is_restricted: true },
    });
    await expect(getComposePage('fictional-star', null)).rejects.toThrow(
      `redirect:${routes.restricted}`,
    );
    expect(mock.port).not.toHaveBeenCalled();
  });
  it('redirects incomplete artist profile consistently with existing login landing', async () => {
    mock.session.mockResolvedValue({
      status: 'authenticated',
      profile: { ...profile, onboarding_completed_at: null },
    });
    await expect(getComposeMenu(null)).rejects.toThrow(
      `redirect:${routes.onboarding}`,
    );
  });
  it('redirects anonymous actor without exposing draft', async () => {
    mock.session.mockResolvedValue({ status: 'anonymous' });
    await expect(getComposePage('fictional-star', null)).rejects.toThrow(
      `redirect:${routes.start}`,
    );
    expect(mock.port).not.toHaveBeenCalled();
  });
  it.each([
    ['unconfigured', 'SETUP_NOT_READY'],
    ['unavailable', 'UNAVAILABLE'],
  ])('fails %s session closed', async (status, code) => {
    mock.session.mockResolvedValue({ status });
    expect(await getComposePage('fictional-star', null)).toEqual({
      ok: false,
      code,
    });
    expect(mock.page).not.toHaveBeenCalled();
  });
  it('passes unknown slug/draft to strict service validation without guessing', async () => {
    await getComposePage(['not-a-slug'], ['bad']);
    expect(mock.page).toHaveBeenCalledWith(
      { composer: true },
      { slug: ['not-a-slug'], messageId: ['bad'] },
    );
  });
});
