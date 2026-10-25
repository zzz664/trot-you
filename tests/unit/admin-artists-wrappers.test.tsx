import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ListPage from '@/app/admin/artists/page';
import DetailPage from '@/app/admin/artists/[id]/page';
import NewPage from '@/app/admin/artists/new/page';
import AccessPage from '@/app/me/artist-access/page';
import { artistId, targetId } from './admin-artists-fixtures';
const mock = vi.hoisted(() => ({ admin: vi.fn(), access: vi.fn() }));
vi.mock('@/server/admin-artists/page', () => ({
  getAdminArtistsPage: mock.admin,
  getArtistAccessPage: mock.access,
}));
vi.mock('@/components/admin-artists/AdminArtistsScreen', () => ({
  AdminArtistsScreen: ({ page }: { page: number }) => (
    <div data-testid="list" data-page={page} />
  ),
}));
vi.mock('@/components/admin-artists/AdminArtistDetailScreen', () => ({
  AdminArtistDetailScreen: ({ id, page }: { id: string; page: number }) => (
    <div data-testid="detail" data-id={id} data-page={page} />
  ),
}));
vi.mock('@/components/admin-artists/AdminArtistCreateScreen', () => ({
  AdminArtistCreateScreen: () => <div data-testid="create" />,
}));
vi.mock('@/components/admin-artists/ArtistAccessScreen', () => ({
  ArtistAccessScreen: ({
    identityId,
    page,
  }: {
    identityId: string;
    page: number;
  }) => <div data-testid="access" data-id={identityId} data-page={page} />,
}));
vi.mock('@/components/admin-artists/AdminArtistsErrorScreen', () => ({
  AdminArtistsErrorScreen: ({
    code,
    access,
  }: {
    code: string;
    access?: boolean;
  }) => (
    <p role="alert" data-access={String(access)}>
      {code}
    </p>
  ),
}));
beforeEach(() => {
  mock.admin.mockReset();
  mock.access.mockReset();
  mock.admin.mockResolvedValue({
    ok: true,
    data: { key: targetId, id: artistId, page: 1 },
  });
  mock.access.mockResolvedValue({ ok: true, data: { key: targetId, page: 1 } });
});
const query = (data: Record<string, string | string[] | undefined> = {}) =>
  Promise.resolve(data);
it('keys the list by actor and page without serializing a data snapshot', async () => {
  const element = await ListPage({ searchParams: query({ page: '2' }) });
  expect(element.key).toBe(`${targetId}:1`);
  expect(mock.admin).toHaveBeenCalledWith({ page: '2' });
  render(element);
  expect(screen.getByTestId('list')).toHaveAttribute('data-page', '1');
});
it('keys detail by actor and exact artist', async () => {
  const element = await DetailPage({
    params: Promise.resolve({ id: artistId }),
    searchParams: query(),
  });
  expect(element.key).toBe(`${targetId}:${artistId}:1`);
  render(element);
  expect(screen.getByTestId('detail')).toHaveAttribute('data-id', artistId);
});
it('guards new registration before showing the form', async () => {
  render(await NewPage({ searchParams: query() }));
  expect(mock.admin).toHaveBeenCalledWith({ id: 'new' });
  expect(screen.getByTestId('create')).toBeInTheDocument();
});
it('passes only the authenticated recipient identity', async () => {
  render(await AccessPage({ searchParams: query() }));
  expect(screen.getByTestId('access')).toHaveAttribute('data-id', targetId);
});
const cases = [
  [
    'list',
    () => ListPage({ searchParams: query({ page: '1', utm: 'unexpected' }) }),
  ],
  [
    'detail',
    () =>
      DetailPage({
        params: Promise.resolve({ id: artistId }),
        searchParams: query({ cursor: 'unknown' }),
      }),
  ],
  ['new', () => NewPage({ searchParams: query({ id: artistId }) })],
  [
    'access',
    () => AccessPage({ searchParams: query({ target_user_id: artistId }) }),
  ],
] as const;
it.each(cases)(
  'renders explicit INVALID_INPUT for unexpected %s query instead of dormant loading',
  async (_name, call) => {
    render(await call());
    expect(screen.getByRole('alert')).toHaveTextContent('INVALID_INPUT');
  },
);
it.each(cases)(
  'prioritizes identity guard failure before %s query diagnostics',
  async (_name, call) => {
    mock.admin.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    mock.access.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    render(await call());
    expect(screen.getByRole('alert')).toHaveTextContent('FORBIDDEN');
  },
);
it('does not render details when guard returned no artist identity', async () => {
  mock.admin.mockResolvedValue({
    ok: true,
    data: { key: targetId, id: null, page: 1 },
  });
  render(
    await DetailPage({
      params: Promise.resolve({ id: artistId }),
      searchParams: query(),
    }),
  );
  expect(screen.getByRole('alert')).toHaveTextContent('INVALID_INPUT');
});

it('detail wrapper passes parsed page and remounts each actor/artist/page identity', async () => {
  mock.admin.mockResolvedValue({
    ok: true,
    data: { key: targetId, id: artistId, page: 2 },
  });
  const element = await DetailPage({
    params: Promise.resolve({ id: artistId }),
    searchParams: query({ page: '2' }),
  });
  expect(mock.admin).toHaveBeenCalledWith({ id: artistId, page: '2' });
  expect(element.key).toBe(`${targetId}:${artistId}:2`);
  render(element);
  expect(screen.getByTestId('detail')).toHaveAttribute('data-page', '2');
});
it('recipient wrapper passes parsed page and remounts each actor/page identity', async () => {
  mock.access.mockResolvedValue({ ok: true, data: { key: targetId, page: 2 } });
  const element = await AccessPage({ searchParams: query({ page: '2' }) });
  expect(mock.access).toHaveBeenCalledWith('2');
  expect(element.key).toBe(`${targetId}:2`);
  render(element);
  expect(screen.getByTestId('access')).toHaveAttribute('data-page', '2');
});

it.each(['detail', 'access'] as const)(
  'rejects unknown %s parameters alongside valid explicit page=1',
  async (kind) => {
    const searchParams = query({ page: '1', unexpected: 'not-allowed' });
    const element =
      kind === 'detail'
        ? await DetailPage({
            params: Promise.resolve({ id: artistId }),
            searchParams,
          })
        : await AccessPage({ searchParams });
    render(element);
    expect(screen.getByRole('alert')).toHaveTextContent('INVALID_INPUT');
  },
);
