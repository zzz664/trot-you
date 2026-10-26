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
import { AttendancePointsScreen } from '@/components/attendance-points/AttendancePointsScreen';
import type {
  PointEntry,
  PointSnapshot,
  AttendanceReceipt,
  PointsError,
} from '@/config/attendance-points';
import { routes } from '@/config/routes';
import messages from '@/messages/ko.json';
const mock = vi.hoisted(() => ({
  read: vi.fn(),
  check: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@/client/attendance-points', () => ({
  fetchPointSnapshot: mock.read,
  checkAttendance: mock.check,
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
const actor = '3b000000-0000-4000-8000-000000000001';
const other = '3b000000-0000-4000-8000-000000000002';
const entryId = '3b000000-0000-4000-8000-000000000003';
const operationId = '3b000000-0000-4000-8000-000000000004';
const entry: PointEntry = {
  id: entryId,
  amount: 10,
  reason: 'attendance',
  earned_on: '2026-10-26',
  created_at: '2026-10-26T04:00:00.000001+00:00',
};
const initial: PointSnapshot = {
  actor_id: actor,
  kst_date: '2026-10-26',
  attendance_entry_id: null,
  attendance_amount: 10,
  balance: 0,
  entries: [],
  next_cursor: null,
};
const completed: PointSnapshot = {
  ...initial,
  attendance_entry_id: entryId,
  balance: 10,
  entries: [entry],
};
const receipt: AttendanceReceipt = {
  actor_id: actor,
  operation_id: operationId,
  entry_id: entryId,
  earned_on: entry.earned_on,
  amount: entry.amount,
};
const ok = <T,>(data: T) => ({ ok: true as const, data });
const copy = messages.attendancePoints;
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
async function open() {
  const view = render(wrapper(<AttendancePointsScreen actorKey={actor} />));
  await screen.findByTestId('attendance-points-content');
  return view;
}
async function check() {
  fireEvent.click(screen.getByRole('button', { name: copy.checkAttendance }));
  await waitFor(() => expect(mock.check).toHaveBeenCalledTimes(1));
}
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  mock.read.mockResolvedValue(ok(initial));
  mock.check.mockResolvedValue(ok(receipt));
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(operationId);
  window.history.replaceState(null, '', routes.points);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
});
it('reads only actor-bound data and exposes an empty private history with server KST date', async () => {
  await open();
  expect(mock.read).toHaveBeenCalledWith(null, expect.any(AbortSignal), actor);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    copy.title,
  );
  expect(screen.getByText(copy.emptyHistory)).toBeInTheDocument();
  expect(screen.getByText('한국 날짜 · 2026-10-26')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: copy.checkAttendance }),
  ).toBeEnabled();
  expect(mock.check).not.toHaveBeenCalled();
});
it('keeps policy-unconfigured attendance disabled without inventing an award', async () => {
  mock.read.mockResolvedValue(ok({ ...initial, attendance_amount: null }));
  await open();
  expect(screen.getByText(copy.policyUnavailable)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: copy.checkAttendance }));
  expect(mock.check).not.toHaveBeenCalled();
  expect(screen.queryByText('현재 출석 포인트 · 10P')).not.toBeInTheDocument();
});
it('a completed day is read-only even if the policy has since disappeared', async () => {
  mock.read.mockResolvedValue(ok({ ...completed, attendance_amount: null }));
  await open();
  expect(
    screen.getByRole('button', { name: copy.checkedAttendance }),
  ).toBeDisabled();
  expect(screen.getByText(copy.policyUnavailable)).toBeInTheDocument();
});
it('records configured zero-point attendance without pretending points were added', async () => {
  mock.read.mockResolvedValueOnce(ok({ ...initial, attendance_amount: 0 }));
  mock.read.mockResolvedValue(
    ok({
      ...completed,
      attendance_amount: 0,
      balance: 0,
      entries: [{ ...entry, amount: 0 }],
    }),
  );
  mock.check.mockResolvedValue(ok({ ...receipt, amount: 0 }));
  await open();
  await check();
  expect(
    await screen.findByTestId('attendance-points-receipt'),
  ).toHaveTextContent('2026-10-26 · 0P');
  expect(
    await screen.findByRole('button', { name: copy.checkedAttendance }),
  ).toBeDisabled();
});
it('submits one immutable operation despite rapid repeated clicks and does not optimistically add a balance', async () => {
  const waiting = deferred<ReturnType<typeof ok<AttendanceReceipt>>>();
  mock.check.mockReturnValue(waiting.promise);
  await open();
  await check();
  fireEvent.click(screen.getByRole('button', { name: copy.checkAttendance }));
  expect(mock.check).toHaveBeenCalledTimes(1);
  expect(mock.check).toHaveBeenCalledWith(
    { operation_id: operationId },
    expect.any(AbortSignal),
    actor,
  );
  expect(
    screen.queryByTestId('attendance-points-receipt'),
  ).not.toBeInTheDocument();
  expect(screen.getByText('0P')).toBeInTheDocument();
  mock.read.mockResolvedValue(ok(completed));
  await act(async () => waiting.resolve(ok(receipt)));
  expect(
    await screen.findByRole('button', { name: copy.checkedAttendance }),
  ).toBeDisabled();
  expect(mock.check).toHaveBeenCalledTimes(1);
});
it.each(['response', 'throw'] as const)(
  'retains %s loss through an unavailable refresh then recovers the same operation',
  async (failure) => {
    if (failure === 'response')
      mock.check.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    else mock.check.mockRejectedValueOnce(new Error('synthetic transport'));
    await open();
    await check();
    expect(
      await screen.findByTestId('attendance-points-recovery'),
    ).toBeInTheDocument();
    mock.read.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
    await screen.findByText(copy.errors.UNAVAILABLE);
    expect(
      screen.queryByTestId('attendance-points-content'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('attendance-points-recovery'),
    ).toBeInTheDocument();
    mock.read.mockResolvedValue(ok(completed));
    fireEvent.click(
      screen.getByRole('button', { name: copy.recoverAttendance }),
    );
    await screen.findByTestId('attendance-points-receipt');
    expect(mock.check).toHaveBeenCalledTimes(2);
    expect(mock.check.mock.calls[1]?.[0]).toEqual(
      mock.check.mock.calls[0]?.[0],
    );
    expect(
      screen.queryByTestId('attendance-points-recovery'),
    ).not.toBeInTheDocument();
  },
);
it('focus refresh preserves uncertain recovery even when today already has a ledger entry', async () => {
  mock.check.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  await open();
  await check();
  await screen.findByTestId('attendance-points-recovery');
  mock.read.mockResolvedValue(ok(completed));
  fireEvent(window, new Event('focus'));
  await screen.findByRole('button', { name: copy.checkedAttendance });
  expect(screen.getByTestId('attendance-points-recovery')).toBeInTheDocument();
  expect(mock.check).toHaveBeenCalledTimes(1);
});
it('acknowledged attendance stays acknowledged if the following read fails', async () => {
  await open();
  mock.read.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
  await check();
  expect(
    await screen.findByTestId('attendance-points-receipt'),
  ).toBeInTheDocument();
  expect(
    screen.queryByTestId('attendance-points-recovery'),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId('attendance-points-content'),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: messages.ui.retry }));
  await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(3));
  expect(mock.check).toHaveBeenCalledTimes(1);
});
it('recovered previous-day receipt never claims attendance for the new server KST day', async () => {
  mock.check.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  await open();
  await check();
  await screen.findByTestId('attendance-points-recovery');
  mock.read.mockResolvedValue(
    ok({ ...initial, kst_date: '2026-10-27', balance: 10, entries: [entry] }),
  );
  fireEvent.click(screen.getByRole('button', { name: copy.recoverAttendance }));
  expect(
    await screen.findByTestId('attendance-points-receipt'),
  ).toHaveTextContent('2026-10-26');
  expect(
    await screen.findByRole('button', { name: copy.checkAttendance }),
  ).toBeEnabled();
  expect(
    screen.queryByRole('button', { name: copy.checkedAttendance }),
  ).not.toBeInTheDocument();
  expect(screen.getByText('한국 날짜 · 2026-10-27')).toBeInTheDocument();
});
it('appends bounded history and uses the current server summary without exposing internal ledger fields', async () => {
  const cursor = { created_at: entry.created_at, id: entry.id };
  const second = {
    ...entry,
    id: other,
    amount: -5,
    reason: 'admin_adjust' as const,
    earned_on: '2026-10-25',
    created_at: '2026-10-25T04:00:00.000001+00:00',
  };
  mock.read.mockResolvedValueOnce(ok({ ...completed, next_cursor: cursor }));
  mock.read.mockResolvedValueOnce(
    ok({ ...completed, balance: 5, entries: [second] }),
  );
  await open();
  fireEvent.click(screen.getByRole('button', { name: copy.loadMore }));
  await waitFor(() =>
    expect(document.querySelectorAll('[data-point-entry-id]')).toHaveLength(2),
  );
  expect(mock.read.mock.calls[1]).toEqual([
    cursor,
    expect.any(AbortSignal),
    actor,
  ]);
  expect(screen.getByText('-5P')).toBeInTheDocument();
  expect(screen.getByText(copy.reasons.admin_adjust)).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: copy.loadMore }),
  ).not.toBeInTheDocument();
  expect(screen.getByText('5P')).toBeInTheDocument();
});
it('refresh resets pagination to the newest history instead of extending an old cursor', async () => {
  mock.read.mockResolvedValueOnce(
    ok({
      ...completed,
      next_cursor: { created_at: entry.created_at, id: entry.id },
    }),
  );
  await open();
  fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
  await screen.findByText(copy.emptyHistory);
  expect(mock.read.mock.calls[1]?.[0]).toBeNull();
});
it.each(['UNAUTHENTICATED', 'FORBIDDEN'] as const)(
  'clears balance, history and unknown mutation intent on read %s',
  async (code) => {
    mock.check.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    await open();
    await check();
    await screen.findByTestId('attendance-points-recovery');
    mock.read.mockResolvedValue({ ok: false, code });
    fireEvent(window, new Event('focus'));
    await screen.findByText(copy.errors[code]);
    expect(
      screen.queryByTestId('attendance-points-content'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('attendance-points-recovery'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('attendance-points-receipt'),
    ).not.toBeInTheDocument();
    expect(mock.check).toHaveBeenCalledTimes(1);
  },
);
it.each(['UNAUTHENTICATED', 'FORBIDDEN'] as const)(
  'clears private data immediately on mutation %s',
  async (code) => {
    mock.check.mockResolvedValue({ ok: false, code });
    await open();
    await check();
    await screen.findByText(copy.errors[code]);
    expect(
      screen.queryByTestId('attendance-points-content'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('attendance-points-recovery'),
    ).not.toBeInTheDocument();
  },
);
it.each([
  'SETUP_NOT_READY',
  'BALANCE_LIMIT',
  'CONFLICT',
  'INVALID_INPUT',
] as const)(
  'renders terminal mutation %s without offering unknown-outcome recovery',
  async (code: PointsError) => {
    mock.check.mockResolvedValue({ ok: false, code });
    await open();
    await check();
    await screen.findByText(copy.errors[code]);
    expect(
      screen.queryByTestId('attendance-points-recovery'),
    ).not.toBeInTheDocument();
    expect(mock.read).toHaveBeenCalledTimes(2);
  },
);
it('keyed actor changes discard old history, receipt and recovery before a new read resolves', async () => {
  mock.check.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  const view = await open();
  await check();
  await screen.findByTestId('attendance-points-recovery');
  const waiting = deferred<ReturnType<typeof ok<PointSnapshot>>>();
  mock.read.mockReturnValue(waiting.promise);
  view.rerender(wrapper(<AttendancePointsScreen actorKey={other} />));
  expect(
    screen.queryByTestId('attendance-points-content'),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId('attendance-points-recovery'),
  ).not.toBeInTheDocument();
  await act(async () => waiting.resolve(ok({ ...initial, actor_id: other })));
  await screen.findByTestId('attendance-points-content');
  expect(mock.read.mock.calls.at(-1)?.[2]).toBe(other);
});
it('ignores a late mutation result for the previous actor', async () => {
  const waiting = deferred<ReturnType<typeof ok<AttendanceReceipt>>>();
  mock.check.mockReturnValue(waiting.promise);
  const view = await open();
  await check();
  const signal = mock.check.mock.calls[0]?.[1] as AbortSignal;
  mock.read.mockResolvedValue(ok({ ...initial, actor_id: other }));
  view.rerender(wrapper(<AttendancePointsScreen actorKey={other} />));
  expect(signal.aborted).toBe(true);
  await screen.findByTestId('attendance-points-content');
  await act(async () => waiting.resolve(ok(receipt)));
  expect(
    screen.queryByTestId('attendance-points-receipt'),
  ).not.toBeInTheDocument();
  expect(screen.getByText(copy.emptyHistory)).toBeInTheDocument();
});
it('rejects an actor-mismatched read before rendering any private points', async () => {
  mock.read.mockResolvedValue(ok({ ...completed, actor_id: other }));
  render(wrapper(<AttendancePointsScreen actorKey={actor} />));
  await screen.findByText(copy.errors.FORBIDDEN);
  expect(
    screen.queryByTestId('attendance-points-content'),
  ).not.toBeInTheDocument();
});
it.each([{ actor_id: other }, { operation_id: other }])(
  'rejects an unbound attendance receipt %j',
  async (patch) => {
    mock.check.mockResolvedValue(ok({ ...receipt, ...patch }));
    await open();
    await check();
    await screen.findByText(copy.errors.FORBIDDEN);
    expect(
      screen.queryByTestId('attendance-points-receipt'),
    ).not.toBeInTheDocument();
  },
);
it('hides private content and preserves uncertain intent when the document is hidden', async () => {
  const waiting = deferred<ReturnType<typeof ok<AttendanceReceipt>>>();
  mock.check.mockReturnValue(waiting.promise);
  await open();
  await check();
  const signal = mock.check.mock.calls[0]?.[1] as AbortSignal;
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'hidden',
  });
  fireEvent(document, new Event('visibilitychange'));
  expect(signal.aborted).toBe(true);
  expect(
    screen.queryByTestId('attendance-points-content'),
  ).not.toBeInTheDocument();
  await act(async () => waiting.resolve(ok(receipt)));
  expect(
    screen.queryByTestId('attendance-points-receipt'),
  ).not.toBeInTheDocument();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  fireEvent(document, new Event('visibilitychange'));
  await screen.findByTestId('attendance-points-content');
  expect(screen.getByTestId('attendance-points-recovery')).toBeInTheDocument();
});
it('navigation away clears an unknown outcome and ignores stale responses', async () => {
  mock.check.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  await open();
  await check();
  await screen.findByTestId('attendance-points-recovery');
  window.history.replaceState(null, '', routes.home);
  fireEvent(window, new PopStateEvent('popstate'));
  expect(
    screen.queryByTestId('attendance-points-content'),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId('attendance-points-recovery'),
  ).not.toBeInTheDocument();
  expect(mock.read).toHaveBeenCalledTimes(1);
});
it('safe home navigation clears private state and disables prefetch', async () => {
  await open();
  const link = screen.getByRole('link', { name: copy.backHome });
  expect(link).toHaveAttribute('href', routes.home);
  expect(link).toHaveAttribute('data-prefetch', 'false');
  fireEvent.click(link);
  expect(
    screen.queryByTestId('attendance-points-content'),
  ).not.toBeInTheDocument();
  expect(mock.navigate).toHaveBeenCalledWith(routes.home);
});
it('does not read or mutate when mounted on a different route', async () => {
  window.history.replaceState(null, '', routes.home);
  render(wrapper(<AttendancePointsScreen actorKey={actor} />));
  await act(async () => {});
  expect(mock.read).not.toHaveBeenCalled();
  expect(mock.check).not.toHaveBeenCalled();
});
it('renders every reason and signed amount using only the safe public projection', async () => {
  const entries = (
    ['attendance', 'post', 'comment', 'admin_adjust'] as const
  ).map((reason, i) => ({
    ...entry,
    id: `3b000000-0000-4000-8000-00000000001${i}`,
    reason,
    amount: i === 3 ? -1 : i,
  }));
  mock.read.mockResolvedValue(ok({ ...completed, entries }));
  await open();
  for (const point of entries) {
    const row = document.querySelector(
      `[data-point-entry-id="${point.id}"]`,
    ) as HTMLElement;
    expect(within(row).getByRole('heading')).toHaveTextContent(
      copy.reasons[point.reason],
    );
    expect(row).not.toHaveTextContent(point.id);
  }
});
it('aborts a pending history read on unmount and ignores its late result', async () => {
  const waiting = deferred<ReturnType<typeof ok<PointSnapshot>>>();
  mock.read.mockReturnValue(waiting.promise);
  const view = render(wrapper(<AttendancePointsScreen actorKey={actor} />));
  await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(1));
  const signal = mock.read.mock.calls[0]?.[1] as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => waiting.resolve(ok(completed)));
  expect(
    screen.queryByTestId('attendance-points-content'),
  ).not.toBeInTheDocument();
});
it('does not accept an old in-flight history result after actor replacement', async () => {
  const waiting = deferred<ReturnType<typeof ok<PointSnapshot>>>();
  mock.read.mockReturnValueOnce(waiting.promise);
  const view = render(wrapper(<AttendancePointsScreen actorKey={actor} />));
  await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(1));
  const signal = mock.read.mock.calls[0]?.[1] as AbortSignal;
  mock.read.mockResolvedValue(ok({ ...initial, actor_id: other }));
  view.rerender(wrapper(<AttendancePointsScreen actorKey={other} />));
  await screen.findByText(copy.emptyHistory);
  expect(signal.aborted).toBe(true);
  await act(async () => waiting.resolve(ok(completed)));
  expect(screen.getByText(copy.emptyHistory)).toBeInTheDocument();
  expect(document.querySelectorAll('[data-point-entry-id]')).toHaveLength(0);
});
it('focus interrupts an in-flight check and explicit recovery reuses its operation while the old response remains ignored', async () => {
  const waiting = deferred<ReturnType<typeof ok<AttendanceReceipt>>>();
  mock.check.mockReturnValueOnce(waiting.promise);
  await open();
  await check();
  const signal = mock.check.mock.calls[0]?.[1] as AbortSignal;
  fireEvent(window, new Event('focus'));
  await screen.findByTestId('attendance-points-content');
  expect(signal.aborted).toBe(true);
  expect(screen.getByTestId('attendance-points-recovery')).toBeInTheDocument();
  expect(mock.check).toHaveBeenCalledTimes(1);
  mock.read.mockResolvedValue(ok(completed));
  fireEvent.click(screen.getByRole('button', { name: copy.recoverAttendance }));
  await screen.findByTestId('attendance-points-receipt');
  expect(mock.check.mock.calls[1]?.[0]).toEqual(mock.check.mock.calls[0]?.[0]);
  await act(async () => waiting.resolve(ok({ ...receipt, amount: 999 })));
  expect(screen.getByTestId('attendance-points-receipt')).toHaveTextContent(
    '10P',
  );
  expect(screen.getByTestId('attendance-points-receipt')).not.toHaveTextContent(
    '999',
  );
});
it('serializes rapid history-page clicks and never writes attendance while paginating', async () => {
  const cursor = { created_at: entry.created_at, id: entry.id };
  mock.read.mockResolvedValueOnce(ok({ ...completed, next_cursor: cursor }));
  const waiting = deferred<ReturnType<typeof ok<PointSnapshot>>>();
  mock.read.mockReturnValue(waiting.promise);
  await open();
  const button = screen.getByRole('button', { name: copy.loadMore });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mock.read).toHaveBeenCalledTimes(2);
  expect(mock.check).not.toHaveBeenCalled();
  await act(async () => waiting.resolve(ok({ ...completed, entries: [] })));
  expect(document.querySelectorAll('[data-point-entry-id]')).toHaveLength(1);
  expect(
    screen.queryByRole('button', { name: copy.loadMore }),
  ).not.toBeInTheDocument();
});
it('restores a persisted page by fetching fresh authority rather than keeping a stale balance', async () => {
  mock.read.mockResolvedValueOnce(ok(completed));
  await open();
  const waiting = deferred<ReturnType<typeof ok<PointSnapshot>>>();
  mock.read.mockReturnValue(waiting.promise);
  fireEvent(window, new PageTransitionEvent('pageshow', { persisted: true }));
  expect(
    screen.queryByTestId('attendance-points-content'),
  ).not.toBeInTheDocument();
  await act(async () => waiting.resolve(ok(initial)));
  await screen.findByText(copy.emptyHistory);
  expect(mock.check).not.toHaveBeenCalled();
});

it.each([
  'SETUP_NOT_READY',
  'BALANCE_LIMIT',
  'CONFLICT',
  'INVALID_INPUT',
] as const)(
  'preserves unknown original outcome through recovery %s while its summary is unavailable',
  async (code) => {
    mock.check.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    await open();
    await check();
    await screen.findByTestId('attendance-points-recovery');
    mock.read.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
    await screen.findByText(copy.errors.UNAVAILABLE);
    expect(
      screen.queryByTestId('attendance-points-content'),
    ).not.toBeInTheDocument();
    mock.check.mockResolvedValueOnce({ ok: false, code });
    fireEvent.click(
      screen.getByRole('button', { name: copy.recoverAttendance }),
    );
    await waitFor(() => expect(mock.check).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByTestId('attendance-points-recovery'),
    ).toBeInTheDocument();
    expect(screen.queryByText(copy.errors[code])).not.toBeInTheDocument();
    mock.read.mockResolvedValue(ok(completed));
    fireEvent.click(
      screen.getByRole('button', { name: copy.recoverAttendance }),
    );
    await screen.findByTestId('attendance-points-receipt');
    expect(mock.check).toHaveBeenCalledTimes(3);
    expect(mock.check.mock.calls.map((call) => call[0])).toEqual([
      { operation_id: operationId },
      { operation_id: operationId },
      { operation_id: operationId },
    ]);
    expect(
      await screen.findByRole('button', { name: copy.checkedAttendance }),
    ).toBeDisabled();
  },
);
