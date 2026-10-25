// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import AdminPage from '@/app/admin/content-calendar/page';
import ArtistPage from '@/app/artist/[slug]/calendar/page';
import { AdminContentCalendarScreen } from '@/components/content-calendar/AdminContentCalendarScreen';
import { ArtistContentCalendarScreen } from '@/components/content-calendar/ArtistContentCalendarScreen';
import { ContentCalendarArtistPicker } from '@/components/content-calendar/ContentCalendarArtistPicker';
import { ContentCalendarErrorScreen } from '@/components/content-calendar/ContentCalendarErrorScreen';
import { calendarActorId, calendarArtistId } from './content-calendar-fixtures';
const mocks = vi.hoisted(() => ({ identity: vi.fn() }));
vi.mock('@/server/content-calendar/page', () => ({
  getContentCalendarPage: mocks.identity,
}));
vi.mock('@/components/content-calendar/AdminContentCalendarScreen', () => ({
  AdminContentCalendarScreen: () => null,
}));
vi.mock('@/components/content-calendar/ArtistContentCalendarScreen', () => ({
  ArtistContentCalendarScreen: () => null,
}));
vi.mock('@/components/content-calendar/ContentCalendarArtistPicker', () => ({
  ContentCalendarArtistPicker: () => null,
}));
vi.mock('@/components/content-calendar/ContentCalendarErrorScreen', () => ({
  ContentCalendarErrorScreen: () => null,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue({
    ok: true,
    data: { key: calendarActorId },
  });
});
it('admin selected artist mounts actor-keyed client without editorial data in RSC props', async () => {
  const query = { artist_id: calendarArtistId, month: '2026-10' };
  const element = await AdminPage({ searchParams: Promise.resolve(query) });
  expect(element.type).toBe(AdminContentCalendarScreen);
  expect(element.props).toEqual({
    actorKey: calendarActorId,
    artistId: calendarArtistId,
    month: '2026-10',
    path: `/admin/content-calendar?artist_id=${calendarArtistId}&month=2026-10`,
  });
  expect(element.key).toContain(calendarActorId);
  expect(mocks.identity).toHaveBeenCalledExactlyOnceWith(true);
});
it('admin picker keeps month and page in exact browser path', async () => {
  const element = await AdminPage({
    searchParams: Promise.resolve({ month: '2026-10', page: '2' }),
  });
  expect(element.type).toBe(ContentCalendarArtistPicker);
  expect(element.props).toEqual({
    actorKey: calendarActorId,
    month: '2026-10',
    page: 2,
    path: '/admin/content-calendar?month=2026-10&page=2',
  });
});
it.each([
  { month: '' },
  { month: '2026-13' },
  { month: ['2026-10', '2026-11'] },
  { artist_id: 'invalid' },
  { artist_id: [calendarArtistId, calendarArtistId] },
  { page: '0' },
  { page: '1001' },
  { page: '01' },
  { page: '1', artist_id: calendarArtistId },
  { actor_id: calendarActorId },
  { cursor: 'bad' },
])(
  'rejects malformed admin route instead of silently defaulting %#',
  async (query) => {
    const element = await AdminPage({ searchParams: Promise.resolve(query) });
    expect(element.type).toBe(ContentCalendarErrorScreen);
    expect(element.props).toEqual({ admin: true, code: 'INVALID_INPUT' });
  },
);
it('artist route keeps only validated slug/month and session key in client props', async () => {
  const element = await ArtistPage({
    params: Promise.resolve({ slug: 'calendar-fixture' }),
    searchParams: Promise.resolve({ month: '2026-10' }),
  });
  expect(element.type).toBe(ArtistContentCalendarScreen);
  expect(element.props).toEqual({
    actorKey: calendarActorId,
    slug: 'calendar-fixture',
    month: '2026-10',
    path: '/artist/calendar-fixture/calendar?month=2026-10',
  });
  expect(element.key).toContain(calendarActorId);
  expect(mocks.identity).toHaveBeenCalledExactlyOnceWith();
});
it.each([
  { month: '' },
  { month: ['2026-10', '2026-11'] },
  { month: '0000-01' },
  { artist_id: calendarArtistId },
  { page: '1' },
  { slug: 'other' },
])('rejects malformed artist route query %#', async (query) => {
  const element = await ArtistPage({
    params: Promise.resolve({ slug: 'calendar-fixture' }),
    searchParams: Promise.resolve(query),
  });
  expect(element.type).toBe(ContentCalendarErrorScreen);
  expect(element.props).toEqual({ code: 'INVALID_INPUT' });
});
it.each(['../calendar', '', 'Invalid', 'with/slash'])(
  'rejects unsupported path slug %j',
  async (slug) => {
    const element = await ArtistPage({
      params: Promise.resolve({ slug }),
      searchParams: Promise.resolve({ month: '2026-10' }),
    });
    expect(element.type).toBe(ContentCalendarErrorScreen);
    expect(element.props.code).toBe('INVALID_INPUT');
  },
);
it.each(['FORBIDDEN', 'UNAVAILABLE', 'SETUP_NOT_READY'])(
  'does not mount client snapshots when identity says %s',
  async (code) => {
    mocks.identity.mockResolvedValue({ ok: false, code });
    const admin = await AdminPage({
      searchParams: Promise.resolve({ month: '2026-10' }),
    });
    expect(admin.type).toBe(ContentCalendarErrorScreen);
    expect(admin.props).toEqual({ admin: true, code });
    const artist = await ArtistPage({
      params: Promise.resolve({ slug: 'calendar-fixture' }),
      searchParams: Promise.resolve({ month: '2026-10' }),
    });
    expect(artist.type).toBe(ContentCalendarErrorScreen);
    expect(artist.props).toEqual({ code });
  },
);
