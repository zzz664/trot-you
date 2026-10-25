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
import { AdminContentCalendarScreen } from '@/components/content-calendar/AdminContentCalendarScreen';
import { ArtistContentCalendarScreen } from '@/components/content-calendar/ArtistContentCalendarScreen';
import { DialogProvider } from '@/components/ui/DialogProvider';
import {
  adminContentCalendarPath,
  artistContentCalendarPath,
} from '@/config/routes';
import messages from '@/messages/ko.json';
import {
  adminCalendar,
  artistCalendar,
  calendarActorId,
  calendarEntry,
  calendarOtherId,
} from './content-calendar-fixtures';
const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  artist: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/client/content-calendar', () => ({
  fetchAdminContentCalendar: mocks.admin,
  fetchArtistContentCalendar: mocks.artist,
  saveContentCalendar: mocks.save,
  deleteContentCalendar: mocks.remove,
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
      }}
    >
      {children}
    </a>
  ),
}));
const copy = messages.contentCalendar;
const ok = <T,>(data: T) => ({ ok: true as const, data });
const wrapper = (children: ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
    <DialogProvider>{children}</DialogProvider>
  </NextIntlClientProvider>
);
const adminPath = adminContentCalendarPath(
  adminCalendar.month,
  adminCalendar.artist.id,
);
function mountAdmin() {
  window.history.replaceState(null, '', adminPath);
  return render(
    wrapper(
      <AdminContentCalendarScreen
        artistId={adminCalendar.artist.id}
        month={adminCalendar.month}
        actorKey={calendarActorId}
        path={adminPath}
      />,
    ),
  );
}
function visible(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value,
  });
  fireEvent(document, new Event('visibilitychange'));
}
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function confirmDelete(index = 0) {
  fireEvent.click(
    screen.getAllByRole('button', { name: copy.deleteAction })[index]!,
  );
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: copy.deleteDialogConfirm,
    }),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  mocks.admin.mockResolvedValue(ok(adminCalendar));
  mocks.artist.mockResolvedValue(ok(artistCalendar));
  mocks.save.mockResolvedValue(ok(calendarEntry));
  mocks.remove.mockResolvedValue(ok({ id: calendarEntry.id, deleted: true }));
});
it('aborted delete enters exact-operation recovery instead of reusing it when a different row is clicked', async () => {
  const first = deferred();
  mocks.remove
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(ok({ id: calendarEntry.id, deleted: true }));
  mocks.admin.mockResolvedValue(
    ok({
      ...adminCalendar,
      entries: [
        calendarEntry,
        {
          ...calendarEntry,
          id: calendarOtherId,
          date: '2026-10-30',
          topic: 'Second topic',
        },
      ],
    }),
  );
  mountAdmin();
  await screen.findByTestId('content-calendar-list');
  await confirmDelete();
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
  const input = mocks.remove.mock.calls[0]![0];
  visible('hidden');
  expect(screen.queryByTestId('content-calendar-list')).not.toBeInTheDocument();
  expect((mocks.remove.mock.calls[0]![1] as AbortSignal).aborted).toBe(true);
  await act(async () => first.resolve({ ok: false, code: 'UNAVAILABLE' }));
  visible('visible');
  await screen.findByTestId('content-calendar-delete-recovery');
  for (const button of screen.getAllByRole('button', {
    name: copy.deleteAction,
  }))
    expect(button).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: copy.new }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: copy.retryOperation }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(2));
  expect(mocks.remove.mock.calls[1]![0]).toEqual(input);
  expect(mocks.remove.mock.calls[1]![2]).toBe(calendarActorId);
});
it.each(['visibility', 'pagehide', 'popstate', 'focus'])(
  'invalidates an unconfirmed delete dialog on %s, without creating a write intent',
  async (event) => {
    mountAdmin();
    await screen.findByTestId('content-calendar-list');
    fireEvent.click(screen.getByRole('button', { name: copy.deleteAction }));
    await screen.findByRole('dialog');
    if (event === 'visibility') visible('hidden');
    else fireEvent(window, new Event(event));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(mocks.remove).not.toHaveBeenCalled();
    visible('visible');
    await screen.findByTestId('content-calendar-list');
    expect(
      screen.queryByTestId('content-calendar-delete-recovery'),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: copy.deleteAction }));
    await screen.findByRole('dialog');
    expect(mocks.remove).not.toHaveBeenCalled();
  },
);
it('interrupted save restores frozen exact original intent and revision after the visible page reloads', async () => {
  const first = deferred();
  mocks.save
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(
      ok({ ...calendarEntry, topic: 'Pending topic', revision: 2 }),
    );
  mountAdmin();
  await screen.findByTestId('content-calendar-list');
  fireEvent.click(screen.getByRole('button', { name: copy.edit }));
  fireEvent.change(screen.getByLabelText(copy.topic), {
    target: { value: 'Pending topic' },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.save }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  const input = mocks.save.mock.calls[0]![0];
  visible('hidden');
  expect(screen.queryByLabelText(copy.topic)).not.toBeInTheDocument();
  await act(async () => first.resolve({ ok: false, code: 'UNAVAILABLE' }));
  mocks.admin.mockResolvedValue(
    ok({
      ...adminCalendar,
      entries: [{ ...calendarEntry, revision: 2, topic: 'Pending topic' }],
    }),
  );
  visible('visible');
  expect(await screen.findByLabelText(copy.topic)).toHaveValue('Pending topic');
  expect(screen.getByLabelText(copy.topic)).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: copy.retryOperation }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[1]![0]).toEqual(input);
  expect(mocks.save.mock.calls[1]![0].expected_revision).toBe(1);
  expect(mocks.save.mock.calls[1]![2]).toBe(calendarActorId);
});
it('authority failure after interrupted delete discards recovery intent before any new request', async () => {
  const first = deferred();
  mocks.remove.mockReturnValueOnce(first.promise);
  mountAdmin();
  await screen.findByTestId('content-calendar-list');
  await confirmDelete();
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
  visible('hidden');
  await act(async () => first.resolve({ ok: false, code: 'UNAVAILABLE' }));
  mocks.admin.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
  visible('visible');
  await screen.findByText(copy.errors.FORBIDDEN);
  expect(
    screen.queryByRole('button', { name: copy.retryOperation }),
  ).not.toBeInTheDocument();
  expect(screen.queryByTestId('content-calendar-list')).not.toBeInTheDocument();
  expect(mocks.remove).toHaveBeenCalledOnce();
});
it('newer focus reload wins and late older read cannot restore revoked private content', async () => {
  const first = deferred();
  const second = deferred();
  mocks.artist
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const path = artistContentCalendarPath(
    artistCalendar.artist.slug,
    artistCalendar.month,
  );
  window.history.replaceState(null, '', path);
  render(
    wrapper(
      <ArtistContentCalendarScreen
        slug={artistCalendar.artist.slug}
        month={artistCalendar.month}
        actorKey={calendarActorId}
        path={path}
      />,
    ),
  );
  await waitFor(() => expect(mocks.artist).toHaveBeenCalledOnce());
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(mocks.artist).toHaveBeenCalledTimes(2));
  await act(async () => second.resolve({ ok: false, code: 'FORBIDDEN' }));
  expect(await screen.findByText(copy.errors.FORBIDDEN)).toBeVisible();
  await act(async () => first.resolve(ok(artistCalendar)));
  expect(
    screen.queryByText(calendarEntry.example_text!),
  ).not.toBeInTheDocument();
  expect(screen.queryByTestId('content-calendar-list')).not.toBeInTheDocument();
});

it.each(['CONFLICT', 'DATE_CONFLICT'] as const)(
  'error retry dismisses a rejected %s editor before showing the fresh calendar',
  async (code) => {
    mocks.save.mockResolvedValueOnce({ ok: false, code });
    mountAdmin();
    await screen.findByTestId('content-calendar-list');
    fireEvent.click(
      screen.getByRole('button', {
        name: code === 'CONFLICT' ? copy.edit : copy.new,
      }),
    );
    fireEvent.change(screen.getByLabelText(copy.topic), {
      target: { value: 'Stale rejected intent' },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: code === 'CONFLICT' ? copy.save : copy.createSave,
      }),
    );
    await screen.findByText(copy.errors[code]);
    const latest = {
      ...calendarEntry,
      revision: 2,
      topic: 'Fresh stored topic',
    };
    mocks.admin.mockResolvedValue(ok({ ...adminCalendar, entries: [latest] }));
    fireEvent.click(screen.getByRole('button', { name: messages.ui.retry }));
    await waitFor(() => expect(mocks.admin).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByTestId('content-calendar-list'),
    ).toHaveTextContent(latest.topic);
    expect(
      screen.queryByTestId('content-calendar-form'),
    ).not.toBeInTheDocument();
    expect(mocks.save).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: copy.edit }));
    expect(screen.getByLabelText(copy.topic)).toHaveValue(latest.topic);
    fireEvent.click(screen.getByRole('button', { name: copy.save }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1]![0].expected_revision).toBe(2);
    expect(mocks.save.mock.calls[1]![0].operation_id).not.toBe(
      mocks.save.mock.calls[0]![0].operation_id,
    );
  },
);

it('error retry preserves an unknown save outcome as one frozen intent without resubmitting it', async () => {
  mocks.save.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  mountAdmin();
  await screen.findByTestId('content-calendar-list');
  fireEvent.click(screen.getByRole('button', { name: copy.edit }));
  fireEvent.change(screen.getByLabelText(copy.topic), {
    target: { value: 'Exact unknown-outcome intent' },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.save }));
  await screen.findByText(copy.errors.UNAVAILABLE);
  const input = mocks.save.mock.calls[0]![0];
  mocks.admin.mockResolvedValue(
    ok({
      ...adminCalendar,
      entries: [{ ...calendarEntry, revision: 2, topic: input.input.topic }],
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: messages.ui.retry }));
  await waitFor(() => expect(mocks.admin).toHaveBeenCalledTimes(2));
  expect(await screen.findByLabelText(copy.topic)).toHaveValue(
    input.input.topic,
  );
  expect(screen.getByLabelText(copy.topic)).toBeDisabled();
  expect(mocks.save).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: copy.retryOperation }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[1]![0]).toEqual(input);
  expect(mocks.save.mock.calls[1]![0].expected_revision).toBe(1);
});
