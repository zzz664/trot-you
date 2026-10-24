// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDispatchHistoryMenu,
  getDispatchHistoryPage,
} from '@/server/message-dispatch/history-page';
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
vi.mock('@/server/db/message-dispatch', () => ({
  createDispatchPort: mock.port,
  createDispatchCatalogPort: mock.port,
}));
vi.mock('@/server/services/message-dispatch/dispatch', () => ({
  readDispatchContext: mock.page,
}));
vi.mock('@/server/services/message-dispatch/catalog', () => ({
  readDispatchArtists: mock.artists,
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
describe('artist dispatch history server page authorization', () => {
  it('reads current session independently for menu and selected draft without service key', async () => {
    expect((await getDispatchHistoryMenu(null)).ok).toBe(true);
    expect(mock.artists).toHaveBeenCalledExactlyOnceWith(
      { composer: true },
      null,
    );
    expect((await getDispatchHistoryPage('fictional-star')).ok).toBe(true);
    expect(mock.page).toHaveBeenCalledExactlyOnceWith(
      { composer: true },
      { slug: 'fictional-star', messageId: null },
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
    await expect(getDispatchHistoryPage('fictional-star')).rejects.toThrow(
      `redirect:${target}`,
    );
    expect(mock.port).not.toHaveBeenCalled();
  });
  it('redirects current restriction before fetching draft', async () => {
    mock.session.mockResolvedValue({
      status: 'authenticated',
      profile: { ...profile, is_restricted: true },
    });
    await expect(getDispatchHistoryPage('fictional-star')).rejects.toThrow(
      `redirect:${routes.restricted}`,
    );
    expect(mock.port).not.toHaveBeenCalled();
  });
  it('redirects incomplete artist profile consistently with existing login landing', async () => {
    mock.session.mockResolvedValue({
      status: 'authenticated',
      profile: { ...profile, onboarding_completed_at: null },
    });
    await expect(getDispatchHistoryMenu(null)).rejects.toThrow(
      `redirect:${routes.onboarding}`,
    );
  });
  it('redirects anonymous actor without exposing draft', async () => {
    mock.session.mockResolvedValue({ status: 'anonymous' });
    await expect(getDispatchHistoryPage('fictional-star')).rejects.toThrow(
      `redirect:${routes.start}`,
    );
    expect(mock.port).not.toHaveBeenCalled();
  });
  it.each([
    ['unconfigured', 'SETUP_NOT_READY'],
    ['unavailable', 'UNAVAILABLE'],
  ])('fails %s session closed', async (status, code) => {
    mock.session.mockResolvedValue({ status });
    expect(await getDispatchHistoryPage('fictional-star')).toEqual({
      ok: false,
      code,
    });
    expect(mock.page).not.toHaveBeenCalled();
  });
  it('passes unknown slug/draft to strict service validation without guessing', async () => {
    await getDispatchHistoryPage(['not-a-slug']);
    expect(mock.page).toHaveBeenCalledWith(
      { composer: true },
      { slug: ['not-a-slug'], messageId: null },
    );
  });
});
