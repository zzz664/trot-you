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
import { ArtistContentCalendarScreen } from '@/components/content-calendar/ArtistContentCalendarScreen';
import { AdminContentCalendarScreen } from '@/components/content-calendar/AdminContentCalendarScreen';
import { ContentCalendarArtistPicker } from '@/components/content-calendar/ContentCalendarArtistPicker';
import { CalendarEditor } from '@/components/content-calendar/CalendarEditor';
import { ContentCalendarErrorScreen } from '@/components/content-calendar/ContentCalendarErrorScreen';
import { DialogProvider } from '@/components/ui/DialogProvider';
import {
  CONTENT_CALENDAR_ERROR_STATUS,
  type ContentCalendarSaveInput,
} from '@/config/content-calendar';
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
  calendarSave,
} from './content-calendar-fixtures';
const mock = vi.hoisted(() => ({
  admin: vi.fn(),
  artist: vi.fn(),
  artists: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@/client/content-calendar', () => ({
  fetchAdminContentCalendar: mock.admin,
  fetchArtistContentCalendar: mock.artist,
  fetchContentCalendarArtists: mock.artists,
  saveContentCalendar: mock.save,
  deleteContentCalendar: mock.remove,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
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
const artistPath = artistContentCalendarPath(
  artistCalendar.artist.slug,
  artistCalendar.month,
);
function admin() {
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
function artist() {
  window.history.replaceState(null, '', artistPath);
  return render(
    wrapper(
      <ArtistContentCalendarScreen
        slug={artistCalendar.artist.slug}
        month={artistCalendar.month}
        actorKey={calendarActorId}
        path={artistPath}
      />,
    ),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.admin.mockResolvedValue(ok(adminCalendar));
  mock.artist.mockResolvedValue(ok(artistCalendar));
  mock.save.mockResolvedValue(ok(calendarEntry));
  mock.remove.mockResolvedValue(ok({ id: calendarEntry.id, deleted: true }));
  mock.artists.mockResolvedValue(ok({ artists: [], has_more: false }));
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
});
it('artist reads literal examples without compose, edit, delete or fan identity', async () => {
  artist();
  expect(await screen.findByText(calendarEntry.example_text!)).toBeVisible();
  expect(screen.getByTestId('content-calendar-activity')).toHaveTextContent(
    messages.artistReplyActivity.requirementsUnavailable,
  );
  expect(screen.getByText(copy.currentWeekNotice)).toBeVisible();
  expect(
    screen.queryByRole('button', { name: copy.edit }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: copy.deleteAction }),
  ).not.toBeInTheDocument();
  expect(mock.artist).toHaveBeenCalledWith(
    { slug: artistCalendar.artist.slug, month: artistCalendar.month },
    expect.any(AbortSignal),
    calendarActorId,
  );
});
it('renders empty artist month and reloads only upon explicit refresh', async () => {
  mock.artist.mockResolvedValue(ok({ ...artistCalendar, entries: [] }));
  artist();
  expect(await screen.findByText(copy.empty)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
  await waitFor(() => expect(mock.artist).toHaveBeenCalledTimes(2));
});
it('month navigation clears private rows and ignores late previous-route replies', async () => {
  artist();
  await screen.findByText(calendarEntry.example_text!);
  fireEvent.click(screen.getByRole('link', { name: copy.nextMonth }));
  expect(
    screen.queryByText(calendarEntry.example_text!),
  ).not.toBeInTheDocument();
  expect(mock.navigate).toHaveBeenCalledWith(
    artistContentCalendarPath(artistCalendar.artist.slug, '2026-11'),
  );
});
it('history navigation aborts a load before late private data arrives', async () => {
  let resolve!: (value: unknown) => void;
  mock.artist.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  artist();
  await waitFor(() => expect(mock.artist).toHaveBeenCalledOnce());
  window.history.replaceState(null, '', '/artist');
  fireEvent.popState(window);
  await act(async () => resolve(ok(artistCalendar)));
  expect(screen.queryByText(calendarEntry.topic)).not.toBeInTheDocument();
  expect(screen.queryByTestId('content-calendar-list')).not.toBeInTheDocument();
});
it('visibility hides private snapshots and revalidates on return', async () => {
  artist();
  await screen.findByText(calendarEntry.example_text!);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'hidden',
  });
  fireEvent(document, new Event('visibilitychange'));
  expect(screen.queryByTestId('content-calendar-list')).not.toBeInTheDocument();
  mock.artist.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  fireEvent(document, new Event('visibilitychange'));
  expect(await screen.findByText(copy.errors.FORBIDDEN)).toBeVisible();
  expect(screen.queryByTestId('content-calendar-list')).not.toBeInTheDocument();
});
it('admin creates a date topic without dispatch, then refreshes current canonical data', async () => {
  admin();
  await screen.findByTestId('content-calendar-list');
  fireEvent.click(screen.getByRole('button', { name: copy.new }));
  fireEvent.change(screen.getByLabelText(copy.topic), {
    target: { value: '새로운 이야기' },
  });
  fireEvent.change(screen.getByLabelText(copy.exampleLabel), {
    target: { value: '{이름} 그대로' },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.createSave }));
  await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
  expect(mock.save.mock.calls[0]?.[0]).toMatchObject({
    entry_id: null,
    expected_revision: null,
    input: {
      artist_id: calendarEntry.artist_id,
      date: '2026-10-01',
      topic: '새로운 이야기',
      example_text: '{이름} 그대로',
    },
  });
  expect(await screen.findByText(copy.saved)).toBeVisible();
  expect(screen.queryByTestId('content-calendar-form')).not.toBeInTheDocument();
});
it('edit preserves identity/date/revision and cancel does not write', async () => {
  admin();
  await screen.findByTestId('content-calendar-list');
  fireEvent.click(screen.getByRole('button', { name: copy.edit }));
  expect(screen.getByLabelText(copy.date)).toHaveAttribute('readonly');
  expect(screen.getByLabelText(copy.exampleLabel)).toHaveValue(
    calendarEntry.example_text,
  );
  fireEvent.click(screen.getByRole('button', { name: copy.cancel }));
  expect(mock.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: copy.edit }));
  fireEvent.change(screen.getByLabelText(copy.topic), {
    target: { value: '수정' },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.save }));
  await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
  expect(mock.save.mock.calls[0]?.[0]).toMatchObject({
    entry_id: calendarEntry.id,
    expected_revision: 1,
    input: { date: calendarEntry.date, topic: '수정' },
  });
});
it('a stale revision disables resubmit until explicitly refreshed and edited', async () => {
  mock.save.mockResolvedValue({ ok: false, code: 'CONFLICT' });
  admin();
  await screen.findByTestId('content-calendar-list');
  fireEvent.click(screen.getByRole('button', { name: copy.edit }));
  fireEvent.click(screen.getByRole('button', { name: copy.save }));
  expect(await screen.findByText(copy.conflictHint)).toBeVisible();
  expect(screen.getByRole('button', { name: copy.save })).toBeDisabled();
  expect(mock.save).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
  await waitFor(() =>
    expect(
      screen.queryByTestId('content-calendar-form'),
    ).not.toBeInTheDocument(),
  );
});
it('unknown save retries exact same operation and freezes editor', async () => {
  mock.save
    .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
    .mockResolvedValueOnce(ok(calendarEntry));
  admin();
  await screen.findByTestId('content-calendar-list');
  fireEvent.click(screen.getByRole('button', { name: copy.edit }));
  fireEvent.click(screen.getByRole('button', { name: copy.save }));
  expect(await screen.findByText(copy.uncertain)).toBeVisible();
  expect(screen.getByLabelText(copy.topic)).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: copy.retryOperation }));
  await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2));
  expect(mock.save.mock.calls[0]?.[0]).toEqual(mock.save.mock.calls[1]?.[0]);
});
it('duplicate save clicks issue only one operation', async () => {
  let resolve!: (value: unknown) => void;
  mock.save.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  admin();
  await screen.findByTestId('content-calendar-list');
  fireEvent.click(screen.getByRole('button', { name: copy.edit }));
  const save = screen.getByRole('button', { name: copy.save });
  fireEvent.click(save);
  fireEvent.click(save);
  expect(mock.save).toHaveBeenCalledOnce();
  await act(async () => resolve(ok(calendarEntry)));
});
it('delete requires dialog confirmation; dismiss and repeated confirmation stay safe', async () => {
  admin();
  await screen.findByTestId('content-calendar-list');
  fireEvent.click(screen.getByRole('button', { name: copy.deleteAction }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(
    within(dialog).getByRole('button', { name: copy.deleteDialogCancel }),
  );
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(mock.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: copy.deleteAction }));
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: copy.deleteDialogConfirm,
    }),
  );
  await waitFor(() => expect(mock.remove).toHaveBeenCalledOnce());
  expect(mock.remove.mock.calls[0]?.[0]).toMatchObject({
    entry_id: calendarEntry.id,
    expected_revision: 1,
    confirmed: true,
  });
  expect(await screen.findByText(copy.deleted)).toBeVisible();
});
it('unknown delete retains immutable operation even when reloaded list is now empty', async () => {
  mock.remove
    .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
    .mockResolvedValueOnce(ok({ id: calendarEntry.id, deleted: true }));
  admin();
  await screen.findByTestId('content-calendar-list');
  fireEvent.click(screen.getByRole('button', { name: copy.deleteAction }));
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: copy.deleteDialogConfirm,
    }),
  );
  await screen.findByTestId('content-calendar-delete-recovery');
  mock.admin.mockResolvedValue(ok({ ...adminCalendar, entries: [] }));
  fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
  await screen.findByText(copy.empty);
  fireEvent.click(screen.getByRole('button', { name: copy.retryOperation }));
  await waitFor(() => expect(mock.remove).toHaveBeenCalledTimes(2));
  expect(mock.remove.mock.calls[0]?.[0]).toEqual(
    mock.remove.mock.calls[1]?.[0],
  );
});
it('account failure removes editorial text and editor without replaying a mutation', async () => {
  mock.save.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
  admin();
  await screen.findByTestId('content-calendar-list');
  fireEvent.click(screen.getByRole('button', { name: copy.edit }));
  fireEvent.click(screen.getByRole('button', { name: copy.save }));
  await screen.findByText(copy.errors.FORBIDDEN);
  expect(screen.queryByLabelText(copy.topic)).not.toBeInTheDocument();
  expect(screen.queryByTestId('content-calendar-list')).not.toBeInTheDocument();
  expect(mock.save).toHaveBeenCalledOnce();
});
it('editor rejects dates outside current month without mutation', async () => {
  const save = vi.fn();
  const pending = { current: null as ContentCalendarSaveInput | null };
  render(
    wrapper(
      <CalendarEditor
        entry={null}
        artistId={calendarEntry.artist_id}
        month="2026-10"
        busy={false}
        pendingOperation={pending}
        onSave={save}
        onCancel={vi.fn()}
      />,
    ),
  );
  fireEvent.change(screen.getByLabelText(copy.date), {
    target: { value: '2026-11-01' },
  });
  fireEvent.change(screen.getByLabelText(copy.topic), {
    target: { value: '제목' },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.createSave }));
  expect(await screen.findByText(copy.errors.INVALID_INPUT)).toBeVisible();
  expect(save).not.toHaveBeenCalled();
});
it('editor restores exact pending input rather than newer unrelated data', () => {
  const pending = {
    current: {
      ...calendarSave,
      input: { ...calendarSave.input, topic: '미확인 요청' },
    },
  };
  render(
    wrapper(
      <CalendarEditor
        entry={calendarEntry}
        artistId={calendarEntry.artist_id}
        month="2026-10"
        busy={false}
        pendingOperation={pending}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    ),
  );
  expect(screen.getByLabelText(copy.topic)).toHaveValue('미확인 요청');
  expect(screen.getByLabelText(copy.topic)).toBeDisabled();
  expect(
    screen.getByRole('button', { name: copy.retryOperation }),
  ).toBeEnabled();
});
it('admin artist picker handles empty state and account-bound reload', async () => {
  const path = adminContentCalendarPath('2026-10');
  window.history.replaceState(null, '', path);
  render(
    wrapper(
      <ContentCalendarArtistPicker
        month="2026-10"
        page={1}
        path={path}
        actorKey={calendarActorId}
      />,
    ),
  );
  expect(await screen.findByText(copy.artistEmpty)).toBeVisible();
  expect(mock.artists).toHaveBeenCalledWith(
    1,
    expect.any(AbortSignal),
    calendarActorId,
  );
});
it.each(
  Object.keys(CONTENT_CALENDAR_ERROR_STATUS) as Array<
    keyof typeof CONTENT_CALENDAR_ERROR_STATUS
  >,
)('error screen exposes safe %s copy', (code) => {
  render(wrapper(<ContentCalendarErrorScreen code={code} />));
  expect(screen.getByRole('alert')).toHaveTextContent(copy.errors[code]);
});
