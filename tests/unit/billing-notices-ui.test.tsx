import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingNoticesScreen } from '@/components/billing-notices/BillingNoticesScreen';
import { BillingNoticesErrorScreen } from '@/components/billing-notices/BillingNoticesErrorScreen';
import { BillingNoticesLoading } from '@/components/billing-notices/BillingNoticesLoading';
import type {
  BillingNoticeError,
  BillingNoticeList,
  BillingNoticeResult,
} from '@/config/billing-notices';
import { billingNoticePath, routes, subscriptionPath } from '@/config/routes';
import messages from '@/messages/ko.json';
import {
  noticeCursor,
  noticeId,
  noticeList,
  subscriptionId,
} from './billing-notices-ui-fixtures';

const mock = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  preference: vi.fn(),
  refresh: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@/client/billing-notices', () => ({
  fetchBillingNotices: mock.list,
  markBillingNoticeRead: mock.read,
  setBillingNoticePreference: mock.preference,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mock.refresh }),
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
const copy = messages.billingNotices;
const main = () => within(screen.getByRole('main'));
function wrapper(children: ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}
function subject(cursor: string | null = null) {
  return wrapper(<BillingNoticesScreen cursor={cursor} />);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function ready() {
  await main().findByRole('heading', { name: '허구 안내 가수' });
}
function success(data = noticeList()) {
  return { ok: true as const, data };
}
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  window.history.replaceState({}, '', routes.billingNotices);
  mock.list.mockResolvedValue(success());
  mock.read.mockResolvedValue({ ok: true, data: null });
  mock.preference.mockResolvedValue({
    ok: true,
    data: { billingEnabled: true },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete document.documentElement.dataset.fontScale;
});

describe('current authenticated billing notice screen', () => {
  it.each(['normal', 'large', 'xlarge'])(
    'shows exact KRW and KST date with honest read semantics at %s',
    async (scale) => {
      document.documentElement.dataset.fontScale = scale;
      render(subject());
      await ready();
      expect(main().getByText('6,500원 (KRW)')).toBeVisible();
      expect(main().getByText('2026년 10월 27일 00:00')).toBeVisible();
      expect(main().getByText(copy.timeZone)).toBeVisible();
      expect(main().getByText(copy.readMeaning)).toBeVisible();
      expect(main().getByText(copy.mandatory)).toBeVisible();
      expect(main().getByText(copy.preferenceOff)).toBeVisible();
      expect(main().queryByText(noticeId)).not.toBeInTheDocument();
      expect(mock.list).toHaveBeenCalledWith(
        undefined,
        expect.any(AbortSignal),
      );
      expect(mock.read).not.toHaveBeenCalled();
      expect(mock.preference).not.toHaveBeenCalled();
    },
  );
  it('offers only current internal subscription management and clears financial content before navigation', async () => {
    const user = userEvent.setup();
    render(subject());
    await ready();
    const link = main().getByRole('link', { name: '허구 안내 가수 구독 관리' });
    expect(link).toHaveAttribute('href', subscriptionPath(subscriptionId));
    expect(link).toHaveAttribute('data-prefetch', 'false');
    await user.click(link);
    expect(mock.navigate).toHaveBeenCalledWith(
      subscriptionPath(subscriptionId),
    );
    expect(main().queryByText('6,500원 (KRW)')).not.toBeInTheDocument();
  });
  it('has a working labeled Back to subscription management', async () => {
    const user = userEvent.setup();
    render(subject());
    await ready();
    await user.click(main().getByRole('link', { name: copy.back }));
    expect(mock.navigate).toHaveBeenCalledWith(routes.subscriptions);
    expect(main().queryByText('6,500원 (KRW)')).not.toBeInTheDocument();
  });
  it('does not imply absence of billing when the eligible notice list is empty', async () => {
    mock.list.mockResolvedValue(success(noticeList({ notices: [] })));
    render(subject());
    expect(await main().findByText(copy.emptyDescription)).toBeVisible();
    expect(
      main().getByRole('link', { name: copy.manageSubscriptions }),
    ).toHaveAttribute('href', routes.subscriptions);
    expect(
      main().queryByRole('button', { name: copy.markRead }),
    ).not.toBeInTheDocument();
  });
  it('marks read explicitly then reloads current eligibility, without delivery wording', async () => {
    const user = userEvent.setup();
    render(subject());
    await ready();
    mock.list.mockResolvedValue(
      success(
        noticeList({
          notices: [
            { ...noticeList().notices[0]!, readAt: '2026-10-25T01:00:00Z' },
          ],
        }),
      ),
    );
    await user.click(main().getByRole('button', { name: copy.markRead }));
    expect(mock.read).toHaveBeenCalledWith(noticeId, expect.any(AbortSignal));
    await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2));
    expect(
      await main().findByText('읽음 표시: 2026년 10월 25일 10:00'),
    ).toBeVisible();
    expect(
      main().queryByRole('button', { name: copy.markRead }),
    ).not.toBeInTheDocument();
  });
  it('prevents repeated mark-read requests and hides old data while waiting', async () => {
    const pending = deferred<BillingNoticeResult<null>>();
    mock.read.mockReturnValue(pending.promise);
    render(subject());
    await ready();
    const button = main().getByRole('button', { name: copy.markRead });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mock.read).toHaveBeenCalledOnce();
    expect(main().getByText(copy.loading)).toBeVisible();
    expect(main().queryByText('6,500원 (KRW)')).not.toBeInTheDocument();
    await act(async () => pending.resolve({ ok: true, data: null }));
    await ready();
  });
  it.each(['NOT_FOUND', 'UNAUTHENTICATED', 'UNAVAILABLE'] as const)(
    'clears stale notice when mark-read fails with %s and allows fresh retry',
    async (code) => {
      const user = userEvent.setup();
      render(subject());
      await ready();
      mock.read.mockResolvedValue({ ok: false, code });
      await user.click(main().getByRole('button', { name: copy.markRead }));
      expect(await main().findByRole('alert')).toHaveTextContent(
        copy.errors[code],
      );
      expect(main().queryByText('6,500원 (KRW)')).not.toBeInTheDocument();
      mock.list.mockResolvedValue(success(noticeList({ notices: [] })));
      await user.click(main().getByRole('button', { name: messages.ui.retry }));
      expect(await main().findByText(copy.emptyTitle)).toBeVisible();
    },
  );
  it('enables optional billing only through explicit choice and reloads its real status', async () => {
    const user = userEvent.setup();
    const permission = vi.fn();
    vi.stubGlobal('Notification', { requestPermission: permission });
    render(subject());
    await ready();
    mock.list.mockResolvedValue(success(noticeList({ billingEnabled: true })));
    await user.click(
      main().getByRole('button', { name: copy.enablePreference }),
    );
    expect(mock.preference).toHaveBeenCalledWith(true, expect.any(AbortSignal));
    expect(await main().findByText(copy.preferenceOn)).toBeVisible();
    expect(main().getByText(copy.mandatoryPreferenceNote)).toBeVisible();
    expect(permission).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('turns off optional billing without hiding an approved mandatory inapp notice', async () => {
    const user = userEvent.setup();
    mock.list.mockResolvedValue(success(noticeList({ billingEnabled: true })));
    render(subject());
    await ready();
    mock.preference.mockResolvedValue({
      ok: true,
      data: { billingEnabled: false },
    });
    mock.list.mockResolvedValue(success());
    await user.click(
      main().getByRole('button', { name: copy.disablePreference }),
    );
    expect(mock.preference).toHaveBeenCalledWith(
      false,
      expect.any(AbortSignal),
    );
    expect(await main().findByText(copy.preferenceOff)).toBeVisible();
    expect(main().getByText(copy.mandatory)).toBeVisible();
  });
  it('shows optional policy status only when supplied and does not invent a mandatory rule', async () => {
    mock.list.mockResolvedValue(
      success(
        noticeList({
          notices: [{ ...noticeList().notices[0]!, mandatory: false }],
        }),
      ),
    );
    render(subject());
    await ready();
    expect(main().getByText(copy.optional)).toBeVisible();
    expect(main().queryByText(copy.mandatory)).not.toBeInTheDocument();
  });
  it('fails closed on preference mutation failure, then refreshes instead of asserting success', async () => {
    const user = userEvent.setup();
    render(subject());
    await ready();
    mock.preference.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    await user.click(
      main().getByRole('button', { name: copy.enablePreference }),
    );
    expect(await main().findByRole('alert')).toHaveTextContent(
      copy.errors.UNAVAILABLE,
    );
    expect(main().queryByText(copy.preferenceOn)).not.toBeInTheDocument();
    expect(main().queryByText('6,500원 (KRW)')).not.toBeInTheDocument();
  });
  it('clears old amount on refresh and ignores its older late response', async () => {
    const user = userEvent.setup();
    const old = deferred<BillingNoticeResult<BillingNoticeList>>();
    mock.list.mockReturnValueOnce(old.promise);
    render(subject());
    await waitFor(() => expect(mock.list).toHaveBeenCalledOnce());
    // History restoration invalidates the in-flight read and starts a fresh one.
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    await ready();
    await act(async () =>
      old.resolve(
        success(
          noticeList({
            notices: [{ ...noticeList().notices[0]!, amountKrw: 9999 }],
          }),
        ),
      ),
    );
    expect(main().queryByText('9,999원 (KRW)')).not.toBeInTheDocument();
    const next = deferred<BillingNoticeResult<BillingNoticeList>>();
    mock.list.mockReturnValue(next.promise);
    await user.click(main().getByRole('button', { name: copy.refresh }));
    expect(main().queryByText('6,500원 (KRW)')).not.toBeInTheDocument();
    await act(async () => next.resolve(success(noticeList({ notices: [] }))));
    expect(await main().findByText(copy.emptyTitle)).toBeVisible();
  });
  it('aborts on pagehide, ignores a late result, and revalidates BFCache restore', async () => {
    const pending = deferred<BillingNoticeResult<BillingNoticeList>>();
    mock.list.mockReturnValueOnce(pending.promise);
    render(subject());
    await waitFor(() => expect(mock.list).toHaveBeenCalledOnce());
    const signal = mock.list.mock.calls[0]![1] as AbortSignal;
    act(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(success()));
    expect(main().queryByText('6,500원 (KRW)')).not.toBeInTheDocument();
    act(() =>
      window.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true }),
      ),
    );
    await ready();
    expect(mock.list).toHaveBeenCalledTimes(2);
  });
  it('clears when hidden and revalidates after visibility returns', async () => {
    render(subject());
    await ready();
    const visibility = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(main().queryByText('6,500원 (KRW)')).not.toBeInTheDocument();
    visibility.mockReturnValue('visible');
    mock.list.mockResolvedValue(success(noticeList({ notices: [] })));
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(await main().findByText(copy.emptyTitle)).toBeVisible();
  });
  it('does not fetch or render notices after navigation to another route', async () => {
    render(subject());
    await ready();
    window.history.replaceState({}, '', routes.subscriptions);
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(main().queryByText('6,500원 (KRW)')).not.toBeInTheDocument();
    expect(mock.list).toHaveBeenCalledOnce();
  });
  it('uses bounded page links and clears before moving to the next page', async () => {
    const user = userEvent.setup();
    mock.list.mockResolvedValue(
      success(noticeList({ hasMore: true, nextCursor: noticeCursor })),
    );
    render(subject());
    await ready();
    const next = main().getByRole('link', { name: copy.next });
    expect(next).toHaveAttribute('href', billingNoticePath(noticeCursor));
    await user.click(next);
    expect(mock.navigate).toHaveBeenCalledWith(billingNoticePath(noticeCursor));
    expect(main().queryByText('6,500원 (KRW)')).not.toBeInTheDocument();
  });
  it('later page has a first-page link and binds the read to its cursor', async () => {
    window.history.replaceState({}, '', billingNoticePath(noticeCursor));
    render(subject(noticeCursor));
    await ready();
    expect(mock.list).toHaveBeenCalledWith(
      noticeCursor,
      expect.any(AbortSignal),
    );
    expect(main().getByRole('link', { name: copy.first })).toHaveAttribute(
      'href',
      routes.billingNotices,
    );
  });
  it.each([
    'INVALID_INPUT',
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'NOT_FOUND',
    'SETUP_NOT_READY',
    'UNAVAILABLE',
  ] as BillingNoticeError[])(
    'renders main-scoped %s with a real retry',
    async (code) => {
      mock.list.mockResolvedValue({ ok: false, code });
      const user = userEvent.setup();
      render(subject());
      expect(await main().findByRole('alert')).toHaveTextContent(
        copy.errors[code],
      );
      expect(main().queryByText('6,500원 (KRW)')).not.toBeInTheDocument();
      if (code === 'UNAUTHENTICATED')
        expect(main().getByRole('link', { name: copy.signIn })).toHaveAttribute(
          'href',
          routes.start,
        );
      mock.list.mockResolvedValue(success());
      await user.click(main().getByRole('button', { name: messages.ui.retry }));
      await ready();
    },
  );
  it('standalone route error retries and routes Back without private data', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(
      wrapper(<BillingNoticesErrorScreen code="UNAVAILABLE" onRetry={retry} />),
    );
    expect(main().getByRole('alert')).toHaveTextContent(
      copy.errors.UNAVAILABLE,
    );
    await user.click(main().getByRole('button', { name: messages.ui.retry }));
    expect(retry).toHaveBeenCalledOnce();
    expect(main().getByRole('link', { name: copy.back })).toHaveAttribute(
      'href',
      routes.subscriptions,
    );
  });
  it('route setup error refreshes the router when no boundary retry is provided', async () => {
    const user = userEvent.setup();
    render(wrapper(<BillingNoticesErrorScreen code="SETUP_NOT_READY" />));
    await user.click(main().getByRole('button', { name: messages.ui.retry }));
    expect(mock.refresh).toHaveBeenCalledOnce();
  });
  it('loading is text and a status, never a fake notice', () => {
    render(wrapper(<BillingNoticesLoading />));
    expect(main().getByRole('status')).toHaveTextContent(copy.loading);
    expect(main().queryByText('6,500원 (KRW)')).not.toBeInTheDocument();
  });
});
