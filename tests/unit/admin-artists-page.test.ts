// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import {
  getAdminArtistsPage,
  getArtistAccessPage,
} from '@/server/admin-artists/page';
import { artistId } from './admin-artists-fixtures';
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
    profile: { id: artistId, role: 'admin' },
  });
  mocks.redirect.mockImplementation(() => {
    throw new Error('redirect');
  });
});
it('RSC returns identity and navigation only, never private artist/member snapshots', async () => {
  expect(await getAdminArtistsPage()).toEqual({
    ok: true,
    data: { key: artistId, id: null, page: 1 },
  });
});
it('supports exact detail/new and bounded list navigation', async () => {
  expect(await getAdminArtistsPage({ id: 'new' })).toEqual({
    ok: true,
    data: { key: artistId, id: 'new', page: 1 },
  });
  expect(await getAdminArtistsPage({ id: artistId, page: '2' })).toEqual({
    ok: true,
    data: { key: artistId, id: artistId, page: 2 },
  });
});
it.each([{ id: '../else' }, { id: ['new'] }, { page: '0' }, { page: ['1'] }])(
  'rejects malformed navigation %#',
  async (input) => {
    expect(await getAdminArtistsPage(input)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
  },
);
it('redirects anonymous pages to sign in', async () => {
  mocks.session.mockResolvedValue({ status: 'anonymous' });
  await expect(getAdminArtistsPage()).rejects.toThrow('redirect');
  await expect(getArtistAccessPage()).rejects.toThrow('redirect');
});
it.each(['unconfigured', 'unavailable'])(
  'keeps %s failure honest',
  async (status) => {
    mocks.session.mockResolvedValue({ status });
    expect(await getAdminArtistsPage()).toEqual({
      ok: false,
      code: status === 'unconfigured' ? 'SETUP_NOT_READY' : 'UNAVAILABLE',
    });
  },
);
it.each(['artist', 'fan'])(
  'does not redirect %s into admin data',
  async (role) => {
    mocks.session.mockResolvedValue({
      status: 'authenticated',
      profile: { id: artistId, role },
    });
    expect(await getAdminArtistsPage()).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(await getArtistAccessPage()).toEqual({
      ok: true,
      data: { key: artistId, page: 1 },
    });
  },
);
it('denies restricted self/privileged flow', async () => {
  mocks.session.mockResolvedValue({
    status: 'authenticated',
    profile: {
      id: artistId,
      role: 'admin',
      is_restricted: true,
      restricted_until: null,
    },
  });
  expect(await getAdminArtistsPage()).toEqual({ ok: false, code: 'FORBIDDEN' });
  expect(await getArtistAccessPage()).toEqual({ ok: false, code: 'FORBIDDEN' });
});

it('validates recipient page only after current identity', async () => {
  mocks.session.mockResolvedValue({
    status: 'authenticated',
    profile: { id: artistId, role: 'fan' },
  });
  expect(await getArtistAccessPage('2')).toEqual({
    ok: true,
    data: { key: artistId, page: 2 },
  });
  expect(await getArtistAccessPage('0')).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
});
