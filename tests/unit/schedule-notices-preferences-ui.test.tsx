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
import { ScheduleNoticeControls } from '@/components/schedule-notices/ScheduleNoticeControls';
import { routes, scheduleDetailPath } from '@/config/routes';
import messages from '@/messages/ko.json';
import {
  scheduleNoticeState,
  scheduleNoticeEventState,
  scheduleNoticeActor,
  scheduleNoticeEvent,
} from './schedule-notices-preferences-fixtures';
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  global: vi.fn(),
  event: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@/client/schedule-notices', () => ({
  fetchScheduleNoticePreferences: mocks.read,
  saveScheduleNoticePreference: mocks.global,
  saveScheduleNoticeEvent: mocks.event,
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
        mocks.navigate(href);
      }}
    >
      {children}
    </a>
  ),
}));
const copy = messages.scheduleNotices;
const ok = <T,>(data: T) => ({ ok: true as const, data });
const wrapper = (children: ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
    {children}
  </NextIntlClientProvider>
);
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function mount(
  event = false,
  path = event ? scheduleDetailPath(scheduleNoticeEvent) : routes.schedules,
) {
  window.history.replaceState({}, '', path);
  return render(
    wrapper(
      <ScheduleNoticeControls
        path={path}
        actorKey={scheduleNoticeActor}
        scheduleId={event ? scheduleNoticeEvent : null}
      />,
    ),
  );
}
beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  window.history.replaceState({}, '', routes.home);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  mocks.read.mockResolvedValue(ok(scheduleNoticeState));
  mocks.global.mockResolvedValue(
    ok({ ...scheduleNoticeState, scheduleEnabled: true }),
  );
  mocks.event.mockResolvedValue(
    ok({ ...scheduleNoticeEventState, eventEnabled: false }),
  );
});
it('shows opt-in off, unconfigured truth and device link without claiming delivery', async () => {
  mount();
  expect(await screen.findByText(copy.preferenceOff)).toBeVisible();
  expect(screen.getByText(copy.notConfigured)).toBeVisible();
  expect(screen.getByText(copy.pushOff)).toBeVisible();
  expect(screen.getByText(copy.deliveryMeaning)).toBeVisible();
  expect(
    screen.getByRole('link', { name: copy.deviceSettings }),
  ).toHaveAttribute('href', routes.notifications);
  expect(mocks.read).toHaveBeenCalledWith(
    null,
    expect.any(AbortSignal),
    scheduleNoticeActor,
  );
  expect(
    screen.queryByRole('heading', { name: copy.eventTitle }),
  ).not.toBeInTheDocument();
});
it('submits explicit desired global value and locks repeated clicks until resolved', async () => {
  const pending = deferred<ReturnType<typeof ok<typeof scheduleNoticeState>>>();
  mocks.global.mockReturnValue(pending.promise);
  mount();
  const button = await screen.findByRole('button', {
    name: copy.enablePreference,
  });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(button).toBeDisabled();
  expect(mocks.global).toHaveBeenCalledExactlyOnceWith(
    true,
    expect.any(AbortSignal),
    scheduleNoticeActor,
  );
  await act(async () =>
    pending.resolve(ok({ ...scheduleNoticeState, scheduleEnabled: true })),
  );
  expect(await screen.findByText(copy.preferenceOn)).toBeVisible();
});
it('re-reads event eligibility after global save instead of mixing old scoped state', async () => {
  mocks.read
    .mockResolvedValueOnce(ok(scheduleNoticeEventState))
    .mockResolvedValueOnce(
      ok({
        ...scheduleNoticeEventState,
        scheduleEnabled: true,
        eligible: false,
      }),
    );
  mount(true);
  fireEvent.click(
    await screen.findByRole('button', { name: copy.enablePreference }),
  );
  expect(await screen.findByText(copy.preferenceOn)).toBeVisible();
  expect(screen.getByText(copy.notEligible)).toBeVisible();
  expect(mocks.read).toHaveBeenCalledTimes(2);
});
it('allows per-event opt-out while global is off and explains current eligibility', async () => {
  mocks.read.mockResolvedValue(
    ok({ ...scheduleNoticeEventState, eligible: false }),
  );
  mount(true);
  const region = await screen.findByRole('region', { name: copy.eventTitle });
  expect(within(region).getByText(copy.notEligible)).toBeVisible();
  expect(within(region).getByText(copy.globalOffHint)).toBeVisible();
  fireEvent.click(
    within(region).getByRole('button', { name: copy.disableEvent }),
  );
  expect(mocks.event).toHaveBeenCalledExactlyOnceWith(
    scheduleNoticeEvent,
    false,
    expect.any(AbortSignal),
    scheduleNoticeActor,
  );
  expect(await screen.findByText(copy.eventOff)).toBeVisible();
});
it('shows approved policy hour only when configured, without hardcoded 10AM claim', async () => {
  mocks.read.mockResolvedValue(
    ok({
      ...scheduleNoticeState,
      configured: true,
      hourKst: 7,
      webpushEnabled: true,
    }),
  );
  mount();
  expect(
    await screen.findByText(copy.timing.replace('{hour}', '7')),
  ).toBeVisible();
  expect(screen.queryByText(copy.notConfigured)).not.toBeInTheDocument();
  expect(screen.getByText(copy.pushOn)).toBeVisible();
});
it('uncertain save hides controls and only read retry reconciles state', async () => {
  mocks.global.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
  mount();
  fireEvent.click(
    await screen.findByRole('button', { name: copy.enablePreference }),
  );
  expect(await screen.findByText(copy.errors.UNAVAILABLE)).toBeVisible();
  expect(
    screen.queryByRole('button', { name: copy.enablePreference }),
  ).not.toBeInTheDocument();
  expect(mocks.global).toHaveBeenCalledOnce();
  mocks.read.mockResolvedValue(
    ok({ ...scheduleNoticeState, scheduleEnabled: true }),
  );
  fireEvent.click(screen.getByRole('button', { name: messages.ui.retry }));
  expect(await screen.findByText(copy.preferenceOn)).toBeVisible();
  expect(mocks.global).toHaveBeenCalledOnce();
});
it.each(['FORBIDDEN', 'UNAUTHENTICATED'] as const)(
  'authority change %s clears displayed preferences',
  async (code) => {
    mount();
    await screen.findByText(copy.preferenceOff);
    mocks.global.mockResolvedValue({ ok: false, code });
    fireEvent.click(
      screen.getByRole('button', { name: copy.enablePreference }),
    );
    expect(await screen.findByText(copy.errors[code])).toBeVisible();
    expect(screen.queryByText(copy.preferenceOff)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: copy.enablePreference }),
    ).not.toBeInTheDocument();
  },
);
it('pagehide aborts a write and bfcache restore obtains fresh state without replay', async () => {
  const pending = deferred<ReturnType<typeof ok<typeof scheduleNoticeState>>>();
  mocks.global.mockReturnValue(pending.promise);
  mount();
  fireEvent.click(
    await screen.findByRole('button', { name: copy.enablePreference }),
  );
  const signal = mocks.global.mock.calls[0]?.[1] as AbortSignal;
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText(copy.preferenceOff)).not.toBeInTheDocument();
  await act(async () =>
    pending.resolve(ok({ ...scheduleNoticeState, scheduleEnabled: true })),
  );
  expect(screen.queryByText(copy.preferenceOn)).not.toBeInTheDocument();
  mocks.read.mockResolvedValue(
    ok({ ...scheduleNoticeState, scheduleEnabled: true }),
  );
  act(() =>
    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: true }),
    ),
  );
  expect(await screen.findByText(copy.preferenceOn)).toBeVisible();
  expect(mocks.global).toHaveBeenCalledOnce();
});
it('hidden tab clears data and canceled late read cannot restore it', async () => {
  const pending = deferred<ReturnType<typeof ok<typeof scheduleNoticeState>>>();
  mocks.read.mockReturnValue(pending.promise);
  mount();
  await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
  act(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await act(async () => pending.resolve(ok(scheduleNoticeState)));
  expect(screen.queryByText(copy.preferenceOff)).not.toBeInTheDocument();
});
it('newer navigation and unmount ignore late write responses', async () => {
  const pending = deferred<ReturnType<typeof ok<typeof scheduleNoticeState>>>();
  mocks.global.mockReturnValue(pending.promise);
  const view = mount();
  fireEvent.click(
    await screen.findByRole('button', { name: copy.enablePreference }),
  );
  act(() => {
    window.history.pushState({}, '', routes.artists);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await act(async () =>
    pending.resolve(ok({ ...scheduleNoticeState, scheduleEnabled: true })),
  );
  expect(screen.queryByText(copy.preferenceOn)).not.toBeInTheDocument();
  view.unmount();
  expect(mocks.global).toHaveBeenCalledOnce();
});
it('leaving through device settings clears preference data before navigation', async () => {
  mount();
  fireEvent.click(
    await screen.findByRole('link', { name: copy.deviceSettings }),
  );
  expect(screen.queryByText(copy.preferenceOff)).not.toBeInTheDocument();
  expect(mocks.navigate).toHaveBeenCalledWith(routes.notifications);
});
