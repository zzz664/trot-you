import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import AdminPage from '@/app/admin/settlements/page';
import ArtistPage from '@/app/artist/settlements/page';
import {
  routes,
  settlementReportActionPath,
  settlementReportExportPath,
  settlementReportsPath,
} from '@/config/routes';
import messages from '@/messages/ko.json';
import { reportActor, reportQuery } from './settlement-reports-ui-fixtures';
const mock = vi.hoisted(() => ({
  page: vi.fn(),
  screen: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/server/settlement-reports/page', () => ({
  getSettlementReportsPage: mock.page,
}));
vi.mock('@/components/settlement-reports/SettlementReportsScreen', () => ({
  SettlementReportsScreen: (props: unknown) => {
    mock.screen(props);
    return <main>report-shell</main>;
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mock.refresh }),
}));
const wrap = (child: ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={messages}>
    {child}
  </NextIntlClientProvider>
);
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  mock.page.mockResolvedValue({ ok: true, data: { key: reportActor } });
});
it.each([
  ['admin', AdminPage],
  ['artist', ArtistPage],
] as const)(
  '%s RSC passes identity and selector only, never a report snapshot',
  async (mode, Page) => {
    render(
      await Page({
        searchParams: Promise.resolve({
          artist_id: reportQuery.artistId,
          month: reportQuery.month,
        }),
      }),
    );
    expect(mock.page).toHaveBeenCalledExactlyOnceWith(mode);
    expect(mock.screen).toHaveBeenCalledExactlyOnceWith({
      actorKey: reportActor,
      mode,
      query: reportQuery,
      artistId: reportQuery.artistId,
      month: reportQuery.month,
      path: settlementReportsPath(reportQuery, mode === 'artist'),
    });
    expect(mock.screen.mock.calls[0]![0]).not.toHaveProperty('report');
  },
);
it('bare admin route is an empty selector and artist id-only entry retains actual URL', async () => {
  const view = render(await AdminPage({ searchParams: Promise.resolve({}) }));
  expect(mock.screen).toHaveBeenLastCalledWith({
    actorKey: reportActor,
    mode: 'admin',
    query: null,
    artistId: '',
    month: expect.any(String),
    path: routes.adminSettlements,
  });
  view.unmount();
  render(
    await ArtistPage({
      searchParams: Promise.resolve({ artist_id: reportQuery.artistId }),
    }),
  );
  expect(mock.screen).toHaveBeenLastCalledWith({
    actorKey: reportActor,
    mode: 'artist',
    query: { artistId: reportQuery.artistId, month: expect.any(String) },
    artistId: reportQuery.artistId,
    month: expect.any(String),
    path: settlementReportsPath({ artistId: reportQuery.artistId }, true),
  });
});
it.each([
  { actor_id: reportActor },
  {
    artist_id: [reportQuery.artistId, reportQuery.artistId],
    month: reportQuery.month,
  },
  { artist_id: reportQuery.artistId, month: '2026-09-02' },
  { artist_id: '../secret' },
  { month: ['2026-09-01', '2026-08-01'] },
])(
  'ambiguous/unknown selector %# never mounts a private report client',
  async (query) => {
    render(wrap(await AdminPage({ searchParams: Promise.resolve(query) })));
    expect(mock.screen).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.settlementReports.errors.INVALID_INPUT,
    );
  },
);
it.each([
  ['admin', AdminPage, routes.admin],
  ['artist', ArtistPage, routes.artist],
] as const)(
  '%s unavailable identity is checked before selector validation',
  async (mode, Page, back) => {
    mock.page.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
    render(
      wrap(await Page({ searchParams: Promise.resolve({ forbidden: 'x' }) })),
    );
    expect(mock.screen).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.settlementReports.errors.FORBIDDEN,
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', back);
    expect(mock.page).toHaveBeenCalledWith(mode);
  },
);
it('route helpers centralize exact modes and escape all caller-controlled path/query values', () => {
  expect(settlementReportsPath()).toBe(routes.adminSettlements);
  expect(settlementReportsPath(null, true, true)).toBe(
    routes.artistSettlementsApi,
  );
  expect(
    settlementReportsPath({ artistId: 'a/b ?+', month: 'c d&' }, false, true),
  ).toBe('/api/admin/settlements?artist_id=a%2Fb+%3F%2B&month=c+d%26');
  expect(settlementReportActionPath('confirm')).toBe(
    '/api/admin/settlements/confirm',
  );
  expect(settlementReportExportPath('../x?', 'a&b')).toBe(
    '/api/admin/settlements/..%2Fx%3F/export?revision=a%26b',
  );
});
