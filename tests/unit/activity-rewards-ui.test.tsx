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
import { ActivityRewardsScreen } from '@/components/activity-rewards/ActivityRewardsScreen';
import type {
  ActivityEntry,
  ActivitySnapshot,
} from '@/config/activity-rewards';
import { routes } from '@/config/routes';
import messages from '@/messages/ko.json';
const mock = vi.hoisted(() => ({ read: vi.fn(), navigate: vi.fn() }));
vi.mock('@/client/activity-rewards', () => ({
  fetchActivitySnapshot: mock.read,
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
const actor = '3c000000-0000-4000-8000-000000000001';
const other = '3c000000-0000-4000-8000-000000000002';
const entry: ActivityEntry = {
  id: '3c000000-0000-4000-8000-000000000003',
  amount: 7,
  reason: 'post',
  earned_on: '2026-10-26',
  created_at: '2026-10-26T04:00:00.000001+00:00',
  outcome: 'awarded',
};
const initial: ActivitySnapshot = {
  actor_id: actor,
  kst_date: '2026-10-26',
  contribution_policy: {
    version: 'synthetic-policy',
    post: { amount: 7, daily_cap: 2, used: 1, awarded: 1, remaining: 1 },
    comment: {
      amount: 0,
      daily_cap: null,
      used: 2,
      awarded: 0,
      remaining: null,
    },
    deleted_content_treatment: 'retain',
  },
  share: { configured: false, reason: 'verification_unconfigured' },
  missions: { configured: false, reason: 'rules_unconfigured' },
  grade: { configured: false, reason: 'score_definition_unconfigured' },
  entries: [],
  next_cursor: null,
};
const copy = messages.activityRewards;
const ok = <T,>(data: T) => ({ ok: true as const, data });
const wrapper = (child: ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
    {child}
  </NextIntlClientProvider>
);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function open(data = initial) {
  mock.read.mockResolvedValueOnce(ok(data));
  const view = render(wrapper(<ActivityRewardsScreen actorKey={actor} />));
  await screen.findByTestId('activity-rewards-content');
  return view;
}
const content = () => screen.queryByTestId('activity-rewards-content');
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  mock.read.mockResolvedValue(ok(initial));
  window.history.replaceState(null, '', routes.activityRewards);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
});
it('reads an actor-bound snapshot and distinguishes recorded attempts from positive awards', async () => {
  await open();
  expect(mock.read).toHaveBeenCalledWith(null, expect.any(AbortSignal), actor);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    copy.title,
  );
  expect(screen.getByText('한국 날짜 · 2026-10-26')).toBeInTheDocument();
  expect(screen.getByText('오늘 기록된 작성 · 2회')).toBeInTheDocument();
  expect(
    screen.getByText('오늘 포인트가 더해진 작성 · 0회'),
  ).toBeInTheDocument();
  expect(screen.getByText(copy.snapshotNotice)).toBeInTheDocument();
});
it('uses explicit unlimited and zero values only inside a configured policy', async () => {
  await open();
  expect(screen.getByText('1회 적립 기준 · 0P')).toBeInTheDocument();
  expect(screen.getByText(copy.unlimitedCap)).toBeInTheDocument();
  expect(screen.getByText(copy.unlimitedRemaining)).toBeInTheDocument();
});
it('unconfigured policy never invents active amounts, caps or grades', async () => {
  await open({ ...initial, contribution_policy: null });
  expect(screen.getByText(copy.policyUnavailable)).toBeInTheDocument();
  expect(screen.queryByText(copy.unlimitedCap)).not.toBeInTheDocument();
  expect(screen.queryByText(/1회 적립 기준/)).not.toBeInTheDocument();
  for (const key of [
    'shareUnavailable',
    'missionsUnavailable',
    'gradeUnavailable',
  ] as const)
    expect(screen.getByText(copy[key])).toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.getAllByRole('link')).toHaveLength(1);
});
it('remaining is displayed as zero when the approved cap has fallen below recorded attempts', async () => {
  await open({
    ...initial,
    contribution_policy: {
      ...initial.contribution_policy!,
      post: { amount: 7, daily_cap: 1, used: 3, awarded: 2, remaining: 0 },
    },
  });
  expect(screen.getByText('오늘 기록된 작성 · 3회')).toBeInTheDocument();
  expect(
    screen.getByText('현재 기준으로 남은 적립 대상 · 0회'),
  ).toBeInTheDocument();
});
it.each(['awarded', 'zero_amount', 'daily_cap', 'legacy'] as const)(
  'shows exact immutable %s provenance rather than guessing from amount',
  async (outcome) => {
    const amount = outcome === 'awarded' || outcome === 'legacy' ? 7 : 0;
    await open({ ...initial, entries: [{ ...entry, outcome, amount }] });
    const item = screen.getByRole('listitem');
    expect(within(item).getByText(copy.outcomes[outcome])).toBeInTheDocument();
    expect(item).toHaveTextContent(
      `기록된 포인트 · ${amount ? '+' : ''}${amount}P`,
    );
    expect(within(item).queryByRole('link')).not.toBeInTheDocument();
  },
);
it('zero legacy amount remains legacy instead of claiming cap exhaustion', async () => {
  await open({
    ...initial,
    entries: [{ ...entry, outcome: 'legacy', amount: 0 }],
  });
  expect(screen.getByText(copy.outcomes.legacy)).toBeInTheDocument();
  expect(screen.queryByText(copy.outcomes.daily_cap)).not.toBeInTheDocument();
});
it('old history stays readable if policy is removed, without source IDs or content', async () => {
  await open({ ...initial, contribution_policy: null, entries: [entry] });
  expect(screen.getByRole('listitem')).toHaveAttribute(
    'data-activity-entry-id',
    entry.id,
  );
  expect(screen.getByText(copy.policyUnavailable)).toBeInTheDocument();
  expect(screen.getByText(copy.historyPrivacy)).toBeInTheDocument();
});
it('a refresh purges prior data before verifying the new read and disables repeated clicks', async () => {
  await open({ ...initial, entries: [entry] });
  const held = deferred<ReturnType<typeof ok<ActivitySnapshot>>>();
  mock.read.mockReturnValueOnce(held.promise);
  const refresh = screen.getByRole('button', { name: copy.refresh });
  fireEvent.click(refresh);
  fireEvent.click(refresh);
  expect(content()).not.toBeInTheDocument();
  expect(refresh).toBeDisabled();
  expect(mock.read).toHaveBeenCalledTimes(2);
  await act(async () => held.resolve(ok(initial)));
  expect(await screen.findByText(copy.emptyHistory)).toBeInTheDocument();
});
it.each([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'UNAVAILABLE',
  'SETUP_NOT_READY',
] as const)(
  'clears previous private data on %s and offers a real re-read',
  async (code) => {
    await open({ ...initial, entries: [entry] });
    mock.read.mockResolvedValueOnce({ ok: false, code });
    fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      copy.errors[code],
    );
    expect(content()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: messages.ui.retry }));
    expect(await screen.findByText(copy.emptyHistory)).toBeInTheDocument();
  },
);
it('an unexpected read rejection fails closed', async () => {
  mock.read.mockRejectedValueOnce(new Error('synthetic failure'));
  render(wrapper(<ActivityRewardsScreen actorKey={actor} />));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    copy.errors.UNAVAILABLE,
  );
  expect(content()).not.toBeInTheDocument();
});
it('a response for another account is rejected even if the client adapter was substituted', async () => {
  mock.read.mockResolvedValueOnce(
    ok({ ...initial, actor_id: other, entries: [entry] }),
  );
  render(wrapper(<ActivityRewardsScreen actorKey={actor} />));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    copy.errors.FORBIDDEN,
  );
  expect(content()).not.toBeInTheDocument();
});
it('actor prop change remounts private state and ignores the old response', async () => {
  const held = deferred<ReturnType<typeof ok<ActivitySnapshot>>>();
  mock.read.mockReturnValueOnce(held.promise);
  const view = render(wrapper(<ActivityRewardsScreen actorKey={actor} />));
  await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(1));
  const signal: AbortSignal = mock.read.mock.calls[0]![1];
  mock.read.mockResolvedValueOnce(ok({ ...initial, actor_id: other }));
  view.rerender(wrapper(<ActivityRewardsScreen actorKey={other} />));
  await screen.findByText(copy.emptyHistory);
  expect(signal.aborted).toBe(true);
  await act(async () => held.resolve(ok({ ...initial, entries: [entry] })));
  expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  expect(mock.read).toHaveBeenLastCalledWith(
    null,
    expect.any(AbortSignal),
    other,
  );
});
it('pagination preserves already verified entries only after next authority check and deduplicates IDs', async () => {
  const cursor = { id: entry.id, created_at: entry.created_at };
  await open({ ...initial, entries: [entry], next_cursor: cursor });
  const held = deferred<ReturnType<typeof ok<ActivitySnapshot>>>();
  mock.read.mockReturnValueOnce(held.promise);
  fireEvent.click(screen.getByRole('button', { name: copy.loadMore }));
  expect(content()).not.toBeInTheDocument();
  expect(mock.read).toHaveBeenLastCalledWith(
    cursor,
    expect.any(AbortSignal),
    actor,
  );
  await act(async () =>
    held.resolve(
      ok({
        ...initial,
        entries: [
          entry,
          { ...entry, id: '3c000000-0000-4000-8000-000000000004' },
        ],
        next_cursor: null,
      }),
    ),
  );
  expect(await screen.findAllByRole('listitem')).toHaveLength(2);
  expect(
    screen.queryByRole('button', { name: copy.loadMore }),
  ).not.toBeInTheDocument();
});
it('pagination denial does not resurrect earlier private rows', async () => {
  await open({
    ...initial,
    entries: [entry],
    next_cursor: { id: entry.id, created_at: entry.created_at },
  });
  mock.read.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
  fireEvent.click(screen.getByRole('button', { name: copy.loadMore }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    copy.errors.FORBIDDEN,
  );
  expect(content()).not.toBeInTheDocument();
});
it.each(['pagehide', 'focus', 'popstate'] as const)(
  '%s cancels and hides old reads before anything else can be shown',
  async (name) => {
    const held = deferred<ReturnType<typeof ok<ActivitySnapshot>>>();
    mock.read.mockReturnValueOnce(held.promise);
    render(wrapper(<ActivityRewardsScreen actorKey={actor} />));
    await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(1));
    const signal: AbortSignal = mock.read.mock.calls[0]![1];
    if (name === 'popstate')
      window.history.replaceState(null, '', routes.points);
    act(() => window.dispatchEvent(new Event(name)));
    expect(signal.aborted).toBe(true);
    await act(async () => held.resolve(ok({ ...initial, entries: [entry] })));
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  },
);
it('hidden documents cancel reads, and visible restoration performs a fresh read', async () => {
  await open({ ...initial, entries: [entry] });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'hidden',
  });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(content()).not.toBeInTheDocument();
  expect(mock.read).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await screen.findByText(copy.emptyHistory);
  expect(mock.read).toHaveBeenCalledTimes(2);
});
it.each([false, true])(
  'pageshow persisted=%s only refreshes restored pages',
  async (persisted) => {
    await open();
    act(() =>
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted })),
    );
    if (persisted)
      await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(2));
    else expect(mock.read).toHaveBeenCalledTimes(1);
  },
);
it('back link disables prefetch and clears private state before route navigation', async () => {
  await open({ ...initial, entries: [entry] });
  const back = screen.getByRole('link', { name: copy.backPoints });
  expect(back).toHaveAttribute('href', routes.points);
  expect(back).toHaveAttribute('data-prefetch', 'false');
  fireEvent.click(back);
  expect(content()).not.toBeInTheDocument();
  expect(mock.navigate).toHaveBeenCalledWith(routes.points);
});
it.each([`${routes.activityRewards}?unknown=1`, routes.points])(
  'does not fetch if the current route is %s',
  async (path) => {
    window.history.replaceState(null, '', path);
    render(wrapper(<ActivityRewardsScreen actorKey={actor} />));
    await act(async () => Promise.resolve());
    expect(mock.read).not.toHaveBeenCalled();
  },
);
it('unmount aborts the active read and discards its later response', async () => {
  const held = deferred<ReturnType<typeof ok<ActivitySnapshot>>>();
  mock.read.mockReturnValueOnce(held.promise);
  const view = render(wrapper(<ActivityRewardsScreen actorKey={actor} />));
  await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(1));
  const signal: AbortSignal = mock.read.mock.calls[0]![1];
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => held.resolve(ok({ ...initial, entries: [entry] })));
  expect(content()).not.toBeInTheDocument();
});
