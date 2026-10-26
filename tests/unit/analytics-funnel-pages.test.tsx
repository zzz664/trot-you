import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import Page from '@/app/admin/analytics/page';
import { AnalyticsFunnelErrorScreen } from '@/components/analytics-funnel/AnalyticsFunnelErrorScreen';
import { AnalyticsFunnelEntry } from '@/components/analytics-funnel/AnalyticsFunnelEntry';
import { routes } from '@/config/routes';
import { ANALYTICS_FUNNEL_ERROR_STATUS } from '@/config/analytics-funnel';
import messages from '@/messages/ko.json';
import * as f from './analytics-funnel-fixtures';
const mock = vi.hoisted(() => ({
  page: vi.fn(),
  screen: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/server/analytics-funnel/page', () => ({
  getAnalyticsFunnelPage: mock.page,
}));
vi.mock('@/components/analytics-funnel/AnalyticsFunnelScreen', () => ({
  AnalyticsFunnelScreen: (props: unknown) => {
    mock.screen(props);
    return <main>aggregate-shell</main>;
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mock.refresh }),
}));
const copy = messages.analyticsFunnel;
const wrap = (child: React.ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={messages}>
    {child}
  </NextIntlClientProvider>
);
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  mock.page.mockResolvedValue({ ok: true, data: { key: f.funnelActor } });
});
it('page sends only expected identity, validated dates and URL to client', async () => {
  const element = await Page({ searchParams: Promise.resolve(f.funnelQuery) });
  render(element);
  expect(mock.screen).toHaveBeenCalledWith({
    actorKey: f.funnelActor,
    query: f.funnelQuery,
    path: '/admin/analytics?from=2026-10-01&to=2026-10-25',
  });
  expect(element.key).toBe(
    `${f.funnelActor}:/admin/analytics?from=2026-10-01&to=2026-10-25`,
  );
});
it('bare URL remains bare while default dates resolve', async () => {
  render(await Page({ searchParams: Promise.resolve({}) }));
  expect(mock.screen).toHaveBeenCalledWith({
    actorKey: f.funnelActor,
    query: expect.objectContaining({
      from: expect.any(String),
      to: expect.any(String),
    }),
    path: routes.analyticsFunnel,
  });
});
it.each([
  { actor_id: f.funnelActor },
  { from: ['2026-10-01', '2026-10-02'], to: '2026-10-25' },
  { from: '2026-10-01' },
  { from: '2026-10-25', to: '2026-10-01' },
  { user: 'private' },
])('page rejects forged or ambiguous query %#', async (query) => {
  render(wrap(await Page({ searchParams: Promise.resolve(query) })));
  expect(mock.screen).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(
    copy.errors.INVALID_INPUT,
  );
});
it.each(
  Object.keys(ANALYTICS_FUNNEL_ERROR_STATUS) as Array<
    keyof typeof ANALYTICS_FUNNEL_ERROR_STATUS
  >,
)('error %s mounts no private client and offers safe refresh', async (code) => {
  mock.page.mockResolvedValueOnce({ ok: false, code });
  render(wrap(await Page({ searchParams: Promise.resolve({ bad: 'x' }) })));
  expect(mock.screen).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(copy.errors[code]);
  fireEvent.click(screen.getByRole('button'));
  expect(mock.refresh).toHaveBeenCalledOnce();
  expect(screen.getByRole('link')).toHaveAttribute('href', routes.admin);
});
it('standalone error screen has no private snapshot', () => {
  render(wrap(<AnalyticsFunnelErrorScreen code="UNAVAILABLE" />));
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    copy.title,
  );
  expect(
    screen.queryByTestId('analytics-funnel-content'),
  ).not.toBeInTheDocument();
});
it('admin entry centralizes target without prefetch', () => {
  render(
    <AnalyticsFunnelEntry
      title={copy.title}
      description={copy.entryDescription}
      label={copy.entryOpen}
    />,
  );
  expect(screen.getByRole('link', { name: copy.entryOpen })).toHaveAttribute(
    'href',
    routes.analyticsFunnel,
  );
});
