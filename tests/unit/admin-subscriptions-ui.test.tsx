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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminSubscriptionsScreen } from '@/components/admin-subscriptions/AdminSubscriptionsScreen';
import { AdminSubscriptionsEntry } from '@/components/admin-subscriptions/AdminSubscriptionsEntry';
import { AdminSubscriptionsLoading } from '@/components/admin-subscriptions/AdminSubscriptionsLoading';
import { AdminSubscriptionsErrorScreen } from '@/components/admin-subscriptions/AdminSubscriptionsErrorScreen';
import {
  ADMIN_SUBSCRIPTIONS,
  ADMIN_SUBSCRIPTION_ERROR_STATUS,
  type AdminSubscriptionDashboard,
  type AdminSubscriptionQuery,
  type AdminSubscriptionResult,
} from '@/config/admin-subscriptions';
import { adminSubscriptionPath, routes } from '@/config/routes';
import messages from '@/messages/ko.json';
import {
  subscriptionArtist,
  subscriptionCurrent,
  subscriptionDashboard,
  subscriptionPeriod,
  subscriptionQuery,
} from './admin-subscriptions-fixtures';

const mock = vi.hoisted(() => ({
  load: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@/client/admin-subscriptions', () => ({
  fetchAdminSubscriptionDashboard: mock.load,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mock.refresh, push: mock.push }),
}));
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
const copy = messages.adminSubscriptions;
const ok = <T,>(data: T) => ({ ok: true as const, data });
const wrapper = (children: ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
    {children}
  </NextIntlClientProvider>
);
const main = () => within(screen.getByRole('main'));
const path = adminSubscriptionPath(subscriptionQuery);
const result = () =>
  document.querySelector('[data-admin-subscriptions-result]');
function metric(scope: string, key: string) {
  const element = document.querySelector(
    `${scope} [data-admin-subscriptions-metric="${key}"] dd`,
  );
  if (!(element instanceof HTMLElement)) throw new Error('metric missing');
  return element;
}
function open(
  query: AdminSubscriptionQuery = subscriptionQuery,
  source = path,
) {
  return render(
    wrapper(<AdminSubscriptionsScreen query={query} path={source} />),
  );
}
async function ready() {
  await waitFor(() => expect(result()).toBeInTheDocument());
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function visibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value,
  });
  fireEvent(document, new Event('visibilitychange'));
}
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  mock.load.mockResolvedValue(ok(structuredClone(subscriptionDashboard)));
  window.history.replaceState({}, '', path);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  document.documentElement.dataset.fontScale = 'large';
});

describe('read-only subscription aggregates', () => {
  it.each(['normal', 'large', 'xlarge'])(
    'renders current versus period, numeric counts, exact nullable rate and boundary at %s',
    async (scale) => {
      document.documentElement.dataset.fontScale = scale;
      open();
      await ready();
      expect(mock.load).toHaveBeenCalledWith(
        subscriptionQuery,
        expect.any(AbortSignal),
      );
      expect(main().getByText(copy.boundary)).toBeVisible();
      expect(main().getByText(copy.currentNote)).toBeVisible();
      expect(main().getByText(copy.partitionNote)).toBeVisible();
      expect(main().getByText(copy.renewalDefinition)).toBeVisible();
      expect(main().getByText(copy.noFinancialData)).toBeVisible();
      expect(main().getByText(copy.historyIncomplete)).toBeVisible();
      for (const [key, value] of Object.entries(subscriptionCurrent))
        expect(
          metric('[data-admin-subscriptions-summary]', key),
        ).toHaveTextContent(String(value));
      expect(
        metric('[data-admin-subscriptions-summary]', 'renewal_rate'),
      ).toHaveTextContent('33.33% (1/3건)');
      expect(main().getByText(/조회 기준:.*2026.*10.*25.*7:00/)).toBeVisible();
      expect(main().getByLabelText(copy.from)).toHaveValue(
        subscriptionQuery.from,
      );
      expect(main().getByLabelText(copy.to)).toHaveValue(subscriptionQuery.to);
      expect(
        main().queryByRole('button', { name: /환불|해지 실행|승인 실행/ }),
      ).not.toBeInTheDocument();
    },
  );
  it('keeps artist overview compact while the summary retains every current and historical metric', async () => {
    open();
    await ready();
    const artist = document.querySelector('[data-admin-subscriptions-artist]');
    expect(
      artist?.querySelectorAll('[data-admin-subscriptions-metric]'),
    ).toHaveLength(5);
    expect(
      artist?.querySelector('[data-admin-subscriptions-metric="active_paid"]'),
    ).not.toBeInTheDocument();
    expect(
      metric('[data-admin-subscriptions-summary]', 'active_paid'),
    ).toHaveTextContent('2');
    expect(
      metric('[data-admin-subscriptions-artist]', 'renewal_rate'),
    ).toHaveTextContent('33.33% (1/3건)');
  });
  it('renders unavailable renewal denominator as unavailable, not zero percent', async () => {
    const period = {
      ...subscriptionPeriod,
      renewal_due: 0,
      renewal_paid: 0,
      renewal_rate: null,
    };
    mock.load.mockResolvedValue(
      ok({
        ...subscriptionDashboard,
        summary: { current: subscriptionCurrent, period },
      }),
    );
    open();
    await ready();
    expect(
      metric('[data-admin-subscriptions-summary]', 'renewal_rate'),
    ).toHaveTextContent(copy.renewalNoData);
  });
  it('does not show incomplete history warning for a fully covered window', async () => {
    mock.load.mockResolvedValue(
      ok({
        ...subscriptionDashboard,
        cancellation_history_complete_from: subscriptionDashboard.window_start,
      }),
    );
    open();
    await ready();
    expect(main().queryByText(copy.historyIncomplete)).not.toBeInTheDocument();
  });
  it('renders explicit empty page and navigable first/previous page', async () => {
    const query = { ...subscriptionQuery, page: 3 };
    const destination = adminSubscriptionPath(query);
    window.history.replaceState({}, '', destination);
    mock.load.mockResolvedValue(
      ok({ ...subscriptionDashboard, artists: [], page: 3 }),
    );
    open(query, destination);
    await main().findByRole('heading', { name: copy.emptyTitle });
    expect(main().getByRole('link', { name: copy.firstPage })).toHaveAttribute(
      'href',
      path,
    );
    expect(
      main().getByRole('link', { name: copy.previousPage }),
    ).toHaveAttribute('href', adminSubscriptionPath({ ...query, page: 2 }));
    expect(
      main().queryByRole('link', { name: copy.nextPage }),
    ).not.toBeInTheDocument();
  });
  it('preserves date range on artist drilldown and clears snapshot before navigation', async () => {
    open();
    await ready();
    const link = main().getByRole('link', { name: copy.filterArtist });
    const expected = adminSubscriptionPath({
      ...subscriptionQuery,
      artist_id: subscriptionArtist,
    });
    expect(link).toHaveAttribute('href', expected);
    expect(link).toHaveAttribute('data-prefetch', 'false');
    fireEvent.click(link);
    expect(mock.navigate).toHaveBeenCalledWith(expected);
    expect(result()).not.toBeInTheDocument();
  });
  it('shows chosen artist and all-artist reset while hiding redundant drilldown', async () => {
    const query = { ...subscriptionQuery, artist_id: subscriptionArtist };
    const destination = adminSubscriptionPath(query);
    window.history.replaceState({}, '', destination);
    mock.load.mockResolvedValue(
      ok({
        ...subscriptionDashboard,
        selected_artist: subscriptionDashboard.artists[0],
      }),
    );
    open(query, destination);
    await ready();
    expect(main().getByRole('link', { name: copy.allArtists })).toHaveAttribute(
      'href',
      path,
    );
    expect(
      main().queryByRole('link', { name: copy.filterArtist }),
    ).not.toBeInTheDocument();
    fireEvent.click(main().getByRole('link', { name: copy.allArtists }));
    expect(result()).not.toBeInTheDocument();
  });
  it('shows next page only when the actual response has more', async () => {
    mock.load.mockResolvedValue(
      ok({ ...subscriptionDashboard, total_artists: 21, has_more: true }),
    );
    open();
    await ready();
    const link = main().getByRole('link', { name: copy.nextPage });
    expect(link).toHaveAttribute(
      'href',
      adminSubscriptionPath({ ...subscriptionQuery, page: 2 }),
    );
    fireEvent.click(link);
    expect(result()).not.toBeInTheDocument();
  });
  it('does not link beyond the bounded page ceiling', async () => {
    const query = { ...subscriptionQuery, page: ADMIN_SUBSCRIPTIONS.maxPage };
    const destination = adminSubscriptionPath(query);
    window.history.replaceState({}, '', destination);
    mock.load.mockResolvedValue(
      ok({
        ...subscriptionDashboard,
        page: query.page,
        total_artists: 30000,
        has_more: true,
      }),
    );
    open(query, destination);
    await ready();
    expect(
      main().queryByRole('link', { name: copy.nextPage }),
    ).not.toBeInTheDocument();
  });
  it.each([
    ['', '2026-10-25'],
    ['2026-10-01', ''],
    ['2026-10-26', '2026-10-25'],
    ['1999-12-31', '2000-01-01'],
    ['2024-01-01', '2026-10-25'],
  ])(
    'rejects invalid range %s through %s before navigation',
    async (from, to) => {
      open();
      await ready();
      fireEvent.change(main().getByLabelText(copy.from), {
        target: { value: from },
      });
      fireEvent.change(main().getByLabelText(copy.to), {
        target: { value: to },
      });
      fireEvent.click(main().getByRole('button', { name: copy.apply }));
      expect(main().getByRole('alert')).toHaveTextContent(
        String(ADMIN_SUBSCRIPTIONS.maxDays),
      );
      expect(mock.push).not.toHaveBeenCalled();
      expect(mock.load).toHaveBeenCalledTimes(1);
      expect(result()).toBeInTheDocument();
    },
  );
  it('applies valid inclusive dates, resets pagination and clears old snapshot', async () => {
    open();
    await ready();
    fireEvent.change(main().getByLabelText(copy.from), {
      target: { value: '2026-10-05' },
    });
    fireEvent.click(main().getByRole('button', { name: copy.apply }));
    expect(mock.push).toHaveBeenCalledWith(
      adminSubscriptionPath({
        ...subscriptionQuery,
        from: '2026-10-05',
        page: 1,
      }),
    );
    expect(result()).not.toBeInTheDocument();
  });
  it('same applied URL revalidates without a redundant navigation', async () => {
    open();
    await ready();
    fireEvent.click(main().getByRole('button', { name: copy.apply }));
    await waitFor(() => expect(mock.load).toHaveBeenCalledTimes(2));
    expect(mock.push).not.toHaveBeenCalled();
  });
  it('fresh read hides stale counts while pending and disables duplicate controls', async () => {
    open();
    await ready();
    const read =
      deferred<AdminSubscriptionResult<AdminSubscriptionDashboard>>();
    mock.load.mockReturnValue(read.promise);
    fireEvent.click(main().getByRole('button', { name: copy.refresh }));
    expect(result()).not.toBeInTheDocument();
    expect(main().getByRole('status')).toHaveTextContent(copy.loading);
    expect(main().getByRole('button', { name: copy.refresh })).toBeDisabled();
    expect(main().getByRole('button', { name: copy.apply })).toBeDisabled();
    expect(main().getByLabelText(copy.from)).toBeDisabled();
    await act(async () => read.resolve(ok(subscriptionDashboard)));
    await ready();
  });
  it.each(Object.keys(ADMIN_SUBSCRIPTION_ERROR_STATUS))(
    'renders safe %s read failure and a read-only retry',
    async (code) => {
      mock.load.mockResolvedValueOnce({ ok: false, code });
      open();
      expect(await main().findByRole('alert')).toHaveTextContent(
        copy.errors[code as keyof typeof copy.errors],
      );
      expect(result()).not.toBeInTheDocument();
      if (code === 'UNAUTHENTICATED')
        expect(main().getByRole('link', { name: copy.signIn })).toHaveAttribute(
          'href',
          routes.start,
        );
      fireEvent.click(main().getByRole('button', { name: messages.ui.retry }));
      await ready();
      expect(mock.load).toHaveBeenCalledTimes(2);
    },
  );
  it('does not render thrown private transport details', async () => {
    mock.load.mockRejectedValueOnce(new Error('private-credential-test'));
    open();
    expect(await main().findByRole('alert')).toHaveTextContent(
      copy.errors.UNAVAILABLE,
    );
    expect(
      main().queryByText('private-credential-test'),
    ).not.toBeInTheDocument();
  });
});

describe('private subscription resource lifecycle', () => {
  it('loads a bare default URL using its validated original path', async () => {
    window.history.replaceState({}, '', routes.adminSubscriptions);
    open(subscriptionQuery, routes.adminSubscriptions);
    await ready();
    expect(mock.load).toHaveBeenCalledTimes(1);
  });
  it('accepts reordered URL parameters without accepting extras', async () => {
    window.history.replaceState(
      {},
      '',
      `${routes.adminSubscriptions}?to=${subscriptionQuery.to}&from=${subscriptionQuery.from}`,
    );
    open();
    await ready();
  });
  it.each([
    `${path}&unexpected=1`,
    `${path}&from=${subscriptionQuery.from}`,
    routes.admin,
  ])('does not load for an unowned URL %s', async (source) => {
    window.history.replaceState({}, '', source);
    open();
    await act(async () => {});
    expect(mock.load).not.toHaveBeenCalled();
  });
  it('clears snapshot while hidden and rechecks revoked admin role on return', async () => {
    open();
    await ready();
    visibility('hidden');
    expect(result()).not.toBeInTheDocument();
    mock.load.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    visibility('visible');
    expect(await main().findByRole('alert')).toHaveTextContent(
      copy.errors.FORBIDDEN,
    );
    expect(result()).not.toBeInTheDocument();
    expect(mock.load).toHaveBeenCalledTimes(2);
  });
  it('does not start behind a hidden tab', async () => {
    visibility('hidden');
    open();
    await act(async () => {});
    expect(mock.load).not.toHaveBeenCalled();
    visibility('visible');
    await ready();
    expect(mock.load).toHaveBeenCalledTimes(1);
  });
  it('leaving aborts pending request and ignores its late success', async () => {
    const read =
      deferred<AdminSubscriptionResult<AdminSubscriptionDashboard>>();
    mock.load.mockReturnValue(read.promise);
    open();
    await waitFor(() => expect(mock.load).toHaveBeenCalledTimes(1));
    const signal = mock.load.mock.calls[0]?.[1] as AbortSignal;
    window.history.replaceState({}, '', routes.admin);
    fireEvent(window, new PopStateEvent('popstate'));
    expect(signal.aborted).toBe(true);
    await act(async () => read.resolve(ok(subscriptionDashboard)));
    expect(result()).not.toBeInTheDocument();
    expect(mock.load).toHaveBeenCalledTimes(1);
  });
  it('leaving ignores late transport errors as well as success', async () => {
    const read =
      deferred<AdminSubscriptionResult<AdminSubscriptionDashboard>>();
    mock.load.mockReturnValue(read.promise);
    open();
    await waitFor(() => expect(mock.load).toHaveBeenCalledTimes(1));
    window.history.replaceState({}, '', routes.admin);
    fireEvent(window, new PopStateEvent('popstate'));
    await act(async () => read.reject(new Error('private transport')));
    expect(main().queryByRole('alert')).not.toBeInTheDocument();
  });
  it('BFCache restoration verifies current session before rendering numbers', async () => {
    open();
    await ready();
    fireEvent(window, new Event('pagehide'));
    expect(result()).not.toBeInTheDocument();
    mock.load.mockResolvedValue({ ok: false, code: 'UNAUTHENTICATED' });
    fireEvent(window, new PageTransitionEvent('pageshow', { persisted: true }));
    expect(await main().findByRole('alert')).toHaveTextContent(
      copy.errors.UNAUTHENTICATED,
    );
    expect(result()).not.toBeInTheDocument();
  });
  it('ordinary pageshow does not duplicate an active load', async () => {
    open();
    await ready();
    fireEvent(
      window,
      new PageTransitionEvent('pageshow', { persisted: false }),
    );
    expect(mock.load).toHaveBeenCalledTimes(1);
  });
  it('popstate restore starts a fresh request and stale pre-navigation response loses ownership', async () => {
    const old = deferred<AdminSubscriptionResult<AdminSubscriptionDashboard>>();
    mock.load.mockReturnValueOnce(old.promise);
    open();
    await waitFor(() => expect(mock.load).toHaveBeenCalledTimes(1));
    const signal = mock.load.mock.calls[0]?.[1] as AbortSignal;
    fireEvent(window, new PopStateEvent('popstate'));
    await ready();
    expect(signal.aborted).toBe(true);
    await act(async () => old.resolve({ ok: false, code: 'FORBIDDEN' }));
    expect(main().queryByRole('alert')).not.toBeInTheDocument();
    expect(result()).toBeInTheDocument();
  });
  it('unmount aborts outstanding work without replay', async () => {
    const read =
      deferred<AdminSubscriptionResult<AdminSubscriptionDashboard>>();
    mock.load.mockReturnValue(read.promise);
    const view = open();
    await waitFor(() => expect(mock.load).toHaveBeenCalledTimes(1));
    const signal = mock.load.mock.calls[0]?.[1] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => read.resolve(ok(subscriptionDashboard)));
    expect(mock.load).toHaveBeenCalledTimes(1);
  });
  it('admin back clears snapshot before leaving', async () => {
    open();
    await ready();
    fireEvent.click(main().getByRole('link', { name: copy.back }));
    expect(mock.navigate).toHaveBeenCalledWith(routes.admin);
    expect(result()).not.toBeInTheDocument();
  });
});

describe('subscription outer UI states', () => {
  it.each(Object.keys(ADMIN_SUBSCRIPTION_ERROR_STATUS))(
    'error shell renders %s with fresh route retry and safe reset',
    (code) => {
      render(
        wrapper(
          <AdminSubscriptionsErrorScreen
            code={code as keyof typeof ADMIN_SUBSCRIPTION_ERROR_STATUS}
          />,
        ),
      );
      expect(main().getByRole('alert')).toHaveTextContent(
        copy.errors[code as keyof typeof copy.errors],
      );
      fireEvent.click(main().getByRole('button', { name: messages.ui.retry }));
      expect(mock.refresh).toHaveBeenCalledTimes(1);
      expect(main().getByRole('link', { name: copy.reset })).toHaveAttribute(
        'href',
        routes.adminSubscriptions,
      );
      expect(mock.load).not.toHaveBeenCalled();
    },
  );
  it('error boundary uses supplied reset rather than router refresh', () => {
    render(
      wrapper(
        <AdminSubscriptionsErrorScreen
          code="UNAVAILABLE"
          onRetry={mock.navigate}
        />,
      ),
    );
    fireEvent.click(main().getByRole('button', { name: messages.ui.retry }));
    expect(mock.navigate).toHaveBeenCalledTimes(1);
    expect(mock.refresh).not.toHaveBeenCalled();
  });
  it('loading shell exposes understandable text', () => {
    render(wrapper(<AdminSubscriptionsLoading />));
    expect(main().getByRole('heading', { name: copy.title })).toBeVisible();
    expect(main().getByRole('status')).toHaveTextContent(copy.loading);
  });
  it('admin entry links to private dashboard with no prefetch', () => {
    render(
      wrapper(
        <AdminSubscriptionsEntry
          title={copy.title}
          description={copy.entryDescription}
          label={copy.open}
        />,
      ),
    );
    expect(screen.getByRole('link', { name: copy.open })).toHaveAttribute(
      'href',
      routes.adminSubscriptions,
    );
    expect(screen.getByRole('link', { name: copy.open })).toHaveAttribute(
      'data-prefetch',
      'false',
    );
  });
});
