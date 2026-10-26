import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AnalyticsFunnelScreen } from '@/components/analytics-funnel/AnalyticsFunnelScreen';
import {
  ANALYTICS_FUNNEL,
  type AnalyticsFunnelDashboard,
} from '@/config/analytics-funnel';
import { analyticsFunnelPath, routes } from '@/config/routes';
import messages from '@/messages/ko.json';
import * as f from './analytics-funnel-fixtures';
const mock = vi.hoisted(() => ({
  read: vi.fn(),
  navigate: vi.fn(),
  push: vi.fn(),
}));
vi.mock('@/client/analytics-funnel', () => ({
  fetchAnalyticsFunnelDashboard: mock.read,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mock.push }) }));
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    onNavigate,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
    onNavigate?: () => void;
  }) => (
    <a
      {...props}
      href={href}
      data-prefetch={String(prefetch)}
      onClick={(event) => {
        event.preventDefault();
        onNavigate?.();
        mock.navigate(href);
      }}
    >
      {children}
    </a>
  ),
}));
const copy = messages.analyticsFunnel;
const path = analyticsFunnelPath(f.funnelQuery);
const ok = <T,>(data: T) => ({ ok: true as const, data });
const wrap = (child: ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
    {child}
  </NextIntlClientProvider>
);
const element = (actorKey = f.funnelActor, target = path) =>
  wrap(
    <AnalyticsFunnelScreen
      actorKey={actorKey}
      query={f.funnelQuery}
      path={target}
    />,
  );
const content = () => screen.queryByTestId('analytics-funnel-content');
const totals = () => within(screen.getByTestId('analytics-funnel-totals'));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function open(data = f.funnelDashboard) {
  mock.read.mockResolvedValueOnce(ok(data));
  const view = render(element());
  await screen.findByTestId('analytics-funnel-content');
  return view;
}
function pages(): AnalyticsFunnelDashboard {
  return {
    ...f.funnelDashboard,
    events: f.funnelDashboard.events.map((event) => ({
      ...event,
      event_count: event.event_count! * 2,
    })),
    daily: [
      ...f.funnelDashboard.daily.map((row) => ({
        ...row,
        day_kst: '2026-10-24',
      })),
      ...f.funnelDashboard.daily,
    ],
  };
}
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  mock.read.mockResolvedValue(ok(f.funnelDashboard));
  window.history.replaceState(null, '', path);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
});
it('loads a current actor-bound raw aggregate and all thirteen exact labels', async () => {
  await open();
  expect(mock.read).toHaveBeenCalledWith(
    f.funnelQuery,
    expect.any(AbortSignal),
    f.funnelActor,
  );
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    copy.title,
  );
  expect(totals().getAllByRole('listitem')).toHaveLength(13);
  for (const event of f.funnelDashboard.events) {
    expect(
      totals().getByRole('heading', { name: copy.events[event.name] }),
    ).toBeInTheDocument();
    const meter = totals().getByRole('meter', {
      name: `${copy.events[event.name]} 관측 기록 ${event.event_count}건`,
    });
    expect(meter).toHaveAttribute('value', String(event.event_count));
    expect(meter).toHaveAttribute('max', '13');
  }
});
it('discloses current-consent incomplete history, font capture gap and no conversion definition', async () => {
  await open();
  for (const key of [
    'rawDefinition',
    'consentDefinition',
    'historyIncomplete',
    'fontUnavailable',
    'privacy',
    'metricsDescription',
  ] as const)
    expect(screen.getByText(copy[key])).toBeInTheDocument();
  const pending = within(screen.getByTestId('analytics-funnel-metrics'));
  expect(pending.getAllByText(copy.metricUnavailable)).toHaveLength(4);
  expect(pending.queryByText(/%/)).not.toBeInTheDocument();
});
it.each(['unconfigured', 'disabled'] as const)(
  '%s is unavailable, never thirteen fabricated zeros',
  async (status) => {
    await open(f.unavailableFunnel(status));
    expect(
      screen.getByTestId('analytics-funnel-policy-unavailable'),
    ).toHaveTextContent(copy.collection[status]);
    expect(totals().queryAllByRole('meter')).toHaveLength(0);
    expect(totals().getAllByText(copy.countUnavailable)).toHaveLength(13);
    expect(totals().queryByText('관측 기록 · 0건')).not.toBeInTheDocument();
  },
);
it('genuine enabled empty counts retain zero plus incomplete coverage warning', async () => {
  await open({
    ...f.funnelDashboard,
    daily: [],
    events: f.funnelDashboard.events.map((event) => ({
      ...event,
      event_count: 0,
    })),
  });
  expect(totals().getAllByText('관측 기록 · 0건')).toHaveLength(13);
  expect(screen.getByText(copy.empty)).toBeInTheDocument();
  expect(screen.getByText(copy.historyIncomplete)).toBeInTheDocument();
  expect(
    screen.queryByTestId('analytics-funnel-policy-unavailable'),
  ).not.toBeInTheDocument();
});
it('bounds daily DOM to thirteen rows and exposes exact sparse-row range', async () => {
  await open(pages());
  const daily = within(screen.getByTestId('analytics-funnel-daily'));
  expect(daily.getAllByRole('listitem')).toHaveLength(
    ANALYTICS_FUNNEL.dailyPageSize,
  );
  expect(daily.getByText('기록된 항목 1–13 / 26')).toBeInTheDocument();
  expect(daily.getByRole('button', { name: copy.previous })).toBeDisabled();
  fireEvent.click(daily.getByRole('button', { name: copy.next }));
  expect(daily.getByText('기록된 항목 14–26 / 26')).toBeInTheDocument();
  expect(daily.getAllByRole('listitem')[0]).toHaveTextContent('2026-10-25');
  expect(daily.getByRole('button', { name: copy.next })).toBeDisabled();
  fireEvent.click(daily.getByRole('button', { name: copy.previous }));
  expect(daily.getByText('기록된 항목 1–13 / 26')).toBeInTheDocument();
  expect(mock.read).toHaveBeenCalledTimes(1);
});
it('fresh snapshot resets daily page even for a fast response', async () => {
  const data = pages();
  await open(data);
  fireEvent.click(screen.getByRole('button', { name: copy.next }));
  expect(screen.getByText('기록된 항목 14–26 / 26')).toBeInTheDocument();
  mock.read.mockResolvedValueOnce(
    ok({ ...data, as_of: '2026-10-26T06:00:01Z' }),
  );
  fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
  await screen.findByText('기록된 항목 1–13 / 26');
  expect(screen.queryByText('기록된 항목 14–26 / 26')).not.toBeInTheDocument();
});
it('invalid range stays on screen without I/O or navigation', async () => {
  await open();
  fireEvent.change(screen.getByLabelText(copy.from), {
    target: { value: '2026-10-26' },
  });
  fireEvent.submit(screen.getByRole('form', { name: copy.filterTitle }));
  expect(screen.getByRole('alert')).toHaveTextContent('최대 366일');
  expect(mock.push).not.toHaveBeenCalled();
  expect(mock.read).toHaveBeenCalledTimes(1);
});
it('applying the same canonical range refreshes instead of adding history', async () => {
  await open();
  fireEvent.submit(screen.getByRole('form', { name: copy.filterTitle }));
  await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(2));
  expect(mock.push).not.toHaveBeenCalled();
});
it('new range clears old private snapshot and guards repeated navigation synchronously', async () => {
  await open();
  fireEvent.change(screen.getByLabelText(copy.from), {
    target: { value: '2026-10-02' },
  });
  const form = screen.getByRole('form', { name: copy.filterTitle });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(mock.push).toHaveBeenCalledExactlyOnceWith(
    analyticsFunnelPath({ from: '2026-10-02', to: f.funnelQuery.to }),
  );
  expect(content()).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: copy.apply })).toBeDisabled();
  fireEvent.click(screen.getByRole('link', { name: copy.back }));
  expect(mock.navigate).toHaveBeenCalledWith(routes.admin);
});
it('refresh immediately hides counts while current authority is pending', async () => {
  await open();
  const d = deferred<ReturnType<typeof ok<AnalyticsFunnelDashboard>>>();
  mock.read.mockReturnValueOnce(d.promise);
  fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
  expect(content()).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: copy.refresh })).toBeDisabled();
  await act(async () => d.resolve(ok(f.funnelDashboard)));
  expect(content()).toBeInTheDocument();
});
it.each(['FORBIDDEN', 'UNAUTHENTICATED', 'UNAVAILABLE'] as const)(
  'fresh %s clears old aggregates and safe retry is offered',
  async (code) => {
    await open();
    mock.read.mockResolvedValueOnce({ ok: false, code });
    fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent(copy.errors[code]);
    expect(content()).not.toBeInTheDocument();
    if (code === 'UNAUTHENTICATED')
      expect(screen.getByRole('link', { name: copy.signIn })).toHaveAttribute(
        'href',
        routes.start,
      );
  },
);
it('a wrong returned actor cannot restore data', async () => {
  mock.read.mockResolvedValueOnce(
    ok({ ...f.funnelDashboard, actor_id: f.funnelOther }),
  );
  render(element());
  await screen.findByRole('alert');
  expect(content()).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(copy.errors.FORBIDDEN);
});
it('a wrong returned range cannot restore data', async () => {
  mock.read.mockResolvedValueOnce(
    ok({ ...f.funnelDashboard, from: '2026-10-02' }),
  );
  render(element());
  await screen.findByRole('alert');
  expect(content()).not.toBeInTheDocument();
});
it('actor replacement clears state and old responses cannot win', async () => {
  const old = deferred<ReturnType<typeof ok<AnalyticsFunnelDashboard>>>();
  mock.read.mockReturnValueOnce(old.promise);
  const view = render(element());
  await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(1));
  const oldSignal = mock.read.mock.calls[0]![1] as AbortSignal;
  mock.read.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
  view.rerender(element(f.funnelOther));
  await screen.findByRole('alert');
  await act(async () => old.resolve(ok(f.funnelDashboard)));
  expect(oldSignal.aborted).toBe(true);
  expect(content()).not.toBeInTheDocument();
  expect(mock.read.mock.calls.at(-1)![2]).toBe(f.funnelOther);
});
it('pagehide clears immediately and cancels a pending read without stale restore', async () => {
  await open();
  const d = deferred<ReturnType<typeof ok<AnalyticsFunnelDashboard>>>();
  mock.read.mockReturnValueOnce(d.promise);
  fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
  const signal = mock.read.mock.calls.at(-1)![1] as AbortSignal;
  fireEvent(window, new Event('pagehide'));
  await act(async () => d.resolve(ok(f.funnelDashboard)));
  expect(signal.aborted).toBe(true);
  expect(content()).not.toBeInTheDocument();
});
it('persisted pageshow rechecks authority, nonpersisted pageshow does not duplicate reads', async () => {
  await open();
  fireEvent(window, new PageTransitionEvent('pageshow', { persisted: false }));
  expect(mock.read).toHaveBeenCalledTimes(1);
  mock.read.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
  fireEvent(window, new PageTransitionEvent('pageshow', { persisted: true }));
  await screen.findByRole('alert');
  expect(content()).not.toBeInTheDocument();
  expect(mock.read).toHaveBeenCalledTimes(2);
});
it('hidden document clears counts and visible restore fetches current data', async () => {
  await open();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'hidden',
  });
  fireEvent(document, new Event('visibilitychange'));
  expect(content()).not.toBeInTheDocument();
  expect(mock.read).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  fireEvent(document, new Event('visibilitychange'));
  await screen.findByTestId('analytics-funnel-content');
  expect(mock.read).toHaveBeenCalledTimes(2);
});
it('initial hidden document makes no read until visible', async () => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'hidden',
  });
  render(element());
  await act(async () => undefined);
  expect(mock.read).not.toHaveBeenCalled();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  fireEvent(document, new Event('visibilitychange'));
  await screen.findByTestId('analytics-funnel-content');
});
it('focus refreshes current authority', async () => {
  await open();
  mock.read.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
  fireEvent(window, new Event('focus'));
  await screen.findByRole('alert');
  expect(content()).not.toBeInTheDocument();
});
it('route departure blocks late response and popstate restoration revalidates', async () => {
  await open();
  const d = deferred<ReturnType<typeof ok<AnalyticsFunnelDashboard>>>();
  mock.read.mockReturnValueOnce(d.promise);
  fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
  window.history.pushState(null, '', routes.admin);
  fireEvent(window, new PopStateEvent('popstate'));
  await act(async () => d.resolve(ok(f.funnelDashboard)));
  expect(content()).not.toBeInTheDocument();
  window.history.replaceState(null, '', path);
  fireEvent(window, new PopStateEvent('popstate'));
  await screen.findByTestId('analytics-funnel-content');
});
it('equivalent query order is allowed, duplicates are not treated as the same route', async () => {
  window.history.replaceState(
    null,
    '',
    '/admin/analytics?to=2026-10-25&from=2026-10-01',
  );
  await open();
  window.history.replaceState(null, '', `${path}&from=2026-10-01`);
  fireEvent(window, new PopStateEvent('popstate'));
  expect(content()).not.toBeInTheDocument();
  expect(mock.read).toHaveBeenCalledTimes(1);
});
it('back clears visible aggregate and disables prefetch', async () => {
  await open();
  const link = screen.getByRole('link', { name: copy.back });
  expect(link).toHaveAttribute('data-prefetch', 'false');
  fireEvent.click(link);
  expect(content()).not.toBeInTheDocument();
  expect(mock.navigate).toHaveBeenCalledExactlyOnceWith(routes.admin);
});
it('unmount aborts ownership of outstanding read', async () => {
  const d = deferred<ReturnType<typeof ok<AnalyticsFunnelDashboard>>>();
  mock.read.mockReturnValueOnce(d.promise);
  const view = render(element());
  await waitFor(() => expect(mock.read).toHaveBeenCalledOnce());
  const signal = mock.read.mock.calls[0]![1] as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => d.resolve(ok(f.funnelDashboard)));
});
it('thrown reads produce only safe unavailable copy', async () => {
  mock.read.mockRejectedValueOnce(new Error('private details'));
  render(element());
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent(copy.errors.UNAVAILABLE);
  expect(screen.queryByText('private details')).not.toBeInTheDocument();
});
it('equivalent date query ordering refreshes without duplicating history', async () => {
  const reversed = '/admin/analytics?to=2026-10-25&from=2026-10-01';
  window.history.replaceState(null, '', reversed);
  render(element(f.funnelActor, reversed));
  await screen.findByTestId('analytics-funnel-content');
  fireEvent.submit(screen.getByRole('form', { name: copy.filterTitle }));
  await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(2));
  expect(mock.push).not.toHaveBeenCalled();
});
it('resolved range replacement on the same bare path remounts date inputs and data ownership', async () => {
  window.history.replaceState(null, '', routes.analyticsFunnel);
  const view = render(element(f.funnelActor, routes.analyticsFunnel));
  await screen.findByTestId('analytics-funnel-content');
  const query = { from: '2026-10-02', to: '2026-10-26' };
  mock.read.mockResolvedValueOnce(ok({ ...f.funnelDashboard, ...query }));
  view.rerender(
    wrap(
      <AnalyticsFunnelScreen
        actorKey={f.funnelActor}
        query={query}
        path={routes.analyticsFunnel}
      />,
    ),
  );
  expect(screen.getByLabelText(copy.from)).toHaveValue(query.from);
  expect(screen.getByLabelText(copy.to)).toHaveValue(query.to);
  await screen.findByTestId('analytics-funnel-content');
  expect(mock.read.mock.calls.at(-1)![0]).toEqual(query);
});
