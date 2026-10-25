// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getArtistReplyActivityMenu,
  getArtistReplyActivityPage,
} from '@/server/artist-reply-activity/page';
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
vi.mock('@/server/db/artist-reply-activity', () => ({
  createArtistReplyActivityPort: mock.port,
  createArtistReplyActivityCatalogPort: mock.port,
}));
vi.mock('@/server/services/artist-reply-activity/activity', () => ({
  readArtistReplyActivityPage: mock.page,
  readArtistReplyActivityArtists: mock.artists,
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
  mock.port.mockReturnValue({ activity: true });
  mock.artists.mockResolvedValue({
    ok: true,
    data: { artists: [], hasMore: false, nextSlug: null },
  });
  mock.page.mockResolvedValue({ ok: true, data: { safe: true } });
  mock.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
});
describe('artist reply activity server page authorization', () => {
  it('reads current session independently for menu and selected reply page without service key', async () => {
    expect((await getArtistReplyActivityMenu(null)).ok).toBe(true);
    expect(mock.artists).toHaveBeenCalledExactlyOnceWith(
      { activity: true },
      null,
    );
    expect((await getArtistReplyActivityPage('fictional-star')).ok).toBe(true);
    expect(mock.page).toHaveBeenCalledExactlyOnceWith(
      { activity: true },
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
    await expect(getArtistReplyActivityPage('fictional-star')).rejects.toThrow(
      `redirect:${target}`,
    );
    expect(mock.port).not.toHaveBeenCalled();
  });
  it('redirects current restriction before fetching replies', async () => {
    mock.session.mockResolvedValue({
      status: 'authenticated',
      profile: { ...profile, is_restricted: true },
    });
    await expect(getArtistReplyActivityPage('fictional-star')).rejects.toThrow(
      `redirect:${routes.restricted}`,
    );
    expect(mock.port).not.toHaveBeenCalled();
  });
  it('redirects incomplete artist profile consistently with existing login landing', async () => {
    mock.session.mockResolvedValue({
      status: 'authenticated',
      profile: { ...profile, onboarding_completed_at: null },
    });
    await expect(getArtistReplyActivityMenu(null)).rejects.toThrow(
      `redirect:${routes.onboarding}`,
    );
  });
  it('redirects anonymous actor without exposing replies', async () => {
    mock.session.mockResolvedValue({ status: 'anonymous' });
    await expect(getArtistReplyActivityPage('fictional-star')).rejects.toThrow(
      `redirect:${routes.start}`,
    );
    expect(mock.port).not.toHaveBeenCalled();
  });
  it.each([
    ['unconfigured', 'SETUP_NOT_READY'],
    ['unavailable', 'UNAVAILABLE'],
  ])('fails %s session closed', async (status, code) => {
    mock.session.mockResolvedValue({ status });
    expect(await getArtistReplyActivityPage('fictional-star')).toEqual({
      ok: false,
      code,
    });
    expect(mock.page).not.toHaveBeenCalled();
  });
  it('passes unknown slug/filter to strict service validation without guessing', async () => {
    await getArtistReplyActivityPage(['not-a-slug']);
    expect(mock.page).toHaveBeenCalledWith(
      { activity: true },
      { slug: ['not-a-slug'], messageId: null },
    );
  });
  it('passes an exact message filter and reply cursor to the service', async () => {
    const messageId = 'a3000000-0000-4000-8000-000000000002';
    await getArtistReplyActivityPage('fictional-star', messageId, 'opaque');
    expect(mock.page).toHaveBeenCalledExactlyOnceWith(
      { activity: true },
      { slug: 'fictional-star', messageId, cursor: 'opaque' },
    );
  });
  it('passes duplicate URL parameter arrays to validation rather than choosing one', async () => {
    await getArtistReplyActivityPage(
      'fictional-star',
      ['one', 'two'],
      ['a', 'b'],
    );
    expect(mock.page).toHaveBeenCalledExactlyOnceWith(
      { activity: true },
      { slug: 'fictional-star', messageId: ['one', 'two'], cursor: ['a', 'b'] },
    );
    await getArtistReplyActivityMenu(['one', 'two']);
    expect(mock.artists).toHaveBeenCalledExactlyOnceWith({ activity: true }, [
      'one',
      'two',
    ]);
  });
  it('fails closed without an actor client even if the earlier session was available', async () => {
    mock.context.mockReturnValue({ client: null, port: { verified: true } });
    expect(await getArtistReplyActivityPage('fictional-star')).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(mock.port).not.toHaveBeenCalled();
  });
  it('allows the current expired-restriction state but retains domain authorization', async () => {
    mock.session.mockResolvedValue({
      status: 'authenticated',
      profile: {
        ...profile,
        is_restricted: true,
        restricted_until: '2020-01-01T00:00:00Z',
      },
    });
    mock.page.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
    expect(await getArtistReplyActivityPage('not-owned')).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(mock.redirect).not.toHaveBeenCalled();
  });
});
