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
import { SchedulesScreen } from '@/components/schedules/SchedulesScreen';
import { ScheduleDetailScreen } from '@/components/schedules/ScheduleDetailScreen';
import { ScheduleEditor } from '@/components/schedules/ScheduleEditor';
import { AdminScheduleDelete } from '@/components/schedules/AdminScheduleDelete';
import { AdminScheduleCreateScreen } from '@/components/schedules/AdminScheduleCreateScreen';
import { AdminScheduleDetailScreen } from '@/components/schedules/AdminScheduleDetailScreen';
import { ScheduleErrorScreen } from '@/components/schedules/ScheduleErrorScreen';
import { DialogProvider } from '@/components/ui/DialogProvider';
import {
  routes,
  scheduleListPath,
  scheduleDetailPath,
  adminSchedulePath,
} from '@/config/routes';
import type { AdminArtist } from '@/config/admin-artists';
import type {
  AdminScheduleSaveInput,
  AdminScheduleDeleteInput,
} from '@/config/schedules';
import messages from '@/messages/ko.json';
import {
  scheduleEvent,
  adminSchedule,
  scheduleInput,
} from './schedules-ui-fixtures';
const mock = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  adminDetail: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  artists: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@/client/schedules', () => ({
  fetchSchedules: mock.list,
  fetchScheduleArtists: mock.artists,
  fetchSchedule: mock.detail,
  fetchAdminSchedule: mock.adminDetail,
  saveAdminSchedule: mock.save,
  deleteAdminSchedule: mock.remove,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mock.push, refresh: mock.refresh }),
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
const copy = messages.schedules;
const ok = <T,>(data: T) => ({ ok: true as const, data });
const wrapper = (children: ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
    <DialogProvider>{children}</DialogProvider>
  </NextIntlClientProvider>
);
const artist: AdminArtist = {
  id: scheduleEvent.artist_id,
  slug: scheduleEvent.artist_slug,
  name: scheduleEvent.artist_name,
  intro: null,
  status: 'active',
  grade: 'B',
  agency_name: null,
  contract_started_at: null,
  contract_ended_at: null,
  display_order: 0,
  revision: 1,
  updated_at: scheduleEvent.updated_at,
};
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  window.history.replaceState({}, '', routes.home);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  mock.list.mockResolvedValue(
    ok({
      month: '2026-10',
      items: [scheduleEvent],
      nextCursor: null,
      myArtistIds: [scheduleEvent.artist_id],
    }),
  );
  mock.detail.mockResolvedValue(ok(scheduleEvent));
  mock.adminDetail.mockResolvedValue(ok(adminSchedule));
  mock.artists.mockResolvedValue(ok({ artists: [artist], has_more: false }));
  mock.save.mockResolvedValue(ok({ ...adminSchedule, revision: 2 }));
  mock.remove.mockResolvedValue(ok({ id: adminSchedule.id, deleted: true }));
});
it('shows KST monthly calendar and list, and filters only current accessible subscriptions', async () => {
  const other = {
    ...scheduleEvent,
    id: '3b0d4317-b739-4670-a0ce-02173f1e8109',
    artist_id: '3b0d4317-b739-4670-a0ce-02173f1e8108',
    title: '다른 가수 행사',
  };
  mock.list.mockResolvedValue(
    ok({
      month: '2026-10',
      items: [scheduleEvent, other],
      nextCursor: null,
      myArtistIds: [scheduleEvent.artist_id],
    }),
  );
  const path = scheduleListPath('2026-10');
  window.history.replaceState({}, '', path);
  render(
    wrapper(
      <SchedulesScreen
        query={{ month: '2026-10', cursor: null }}
        path={path}
      />,
    ),
  );
  expect(await screen.findByTestId('schedule-calendar')).toBeVisible();
  expect(document.querySelectorAll('[data-schedule-day]')).toHaveLength(31);
  fireEvent.click(screen.getByRole('radio', { name: copy.listView }));
  const list = screen.getByTestId('schedule-list');
  expect(within(list).getAllByRole('heading', { level: 2 })).toHaveLength(2);
  fireEvent.click(screen.getByRole('checkbox', { name: copy.mineOnly }));
  expect(within(list).queryByText(other.title)).not.toBeInTheDocument();
  expect(within(list).getByText(scheduleEvent.title)).toBeVisible();
  expect(screen.getByRole('link', { name: copy.nextMonth })).toHaveAttribute(
    'href',
    scheduleListPath('2026-11'),
  );
});
it('keeps load-more available for an empty filtered page and appends next data once', async () => {
  mock.list
    .mockResolvedValueOnce(
      ok({
        month: '2026-10',
        items: [],
        nextCursor: 'next',
        myArtistIds: [scheduleEvent.artist_id],
      }),
    )
    .mockResolvedValueOnce(
      ok({
        month: '2026-10',
        items: [scheduleEvent],
        nextCursor: null,
        myArtistIds: [scheduleEvent.artist_id],
      }),
    );
  const path = scheduleListPath('2026-10');
  window.history.replaceState({}, '', path);
  render(
    wrapper(
      <SchedulesScreen
        query={{ month: '2026-10', cursor: null }}
        path={path}
      />,
    ),
  );
  await screen.findByText(copy.partial);
  fireEvent.click(screen.getByRole('checkbox', { name: copy.mineOnly }));
  expect(screen.getByText(copy.mineEmpty)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: copy.more }));
  await screen.findByRole('link', {
    name: `${scheduleEvent.title} 자세히 보기`,
  });
  expect(mock.list).toHaveBeenNthCalledWith(
    2,
    { month: '2026-10', cursor: 'next' },
    expect.any(AbortSignal),
    undefined,
  );
});
it('uses native deliberate external map links with no opener/referrer/prefetch', async () => {
  const path = scheduleDetailPath(scheduleEvent.id);
  window.history.replaceState({}, '', path);
  render(
    wrapper(
      <ScheduleDetailScreen id={scheduleEvent.id} month={null} path={path} />,
    ),
  );
  const kakao = await screen.findByRole('link', { name: copy.kakaoMap });
  expect(kakao).toHaveAttribute(
    'href',
    'https://map.kakao.com/link/map/37.5665,126.978',
  );
  expect(kakao).toHaveAttribute('rel', 'noopener noreferrer');
  expect(kakao).toHaveAttribute('referrerpolicy', 'no-referrer');
  expect(kakao).toHaveAttribute('target', '_blank');
  expect(kakao).not.toHaveAttribute('data-prefetch');
  expect(
    screen.getByRole('link', { name: copy.naverMap }).getAttribute('href'),
  ).toMatch(/^nmap:\/\/map\?/);
  expect(mock.detail).toHaveBeenCalledTimes(1);
});
it('suppresses missing map coordinates without a fake link', async () => {
  mock.detail.mockResolvedValue(ok({ ...scheduleEvent, lat: null, lng: null }));
  const path = scheduleDetailPath(scheduleEvent.id);
  window.history.replaceState({}, '', path);
  render(
    wrapper(
      <ScheduleDetailScreen id={scheduleEvent.id} month={null} path={path} />,
    ),
  );
  await screen.findByText(copy.mapUnavailable);
  expect(
    screen.queryByRole('link', { name: copy.kakaoMap }),
  ).not.toBeInTheDocument();
});
it('preserves exact operation and entered fields on uncertain save, disabling edits until explicit retry', async () => {
  const save = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
    .mockResolvedValueOnce(ok(adminSchedule));
  const pending = { current: null as AdminScheduleSaveInput | null };
  render(
    wrapper(
      <ScheduleEditor
        event={adminSchedule}
        initial={scheduleInput}
        pendingOperation={pending}
        busy={false}
        onSave={save}
        onCancel={vi.fn()}
      />,
    ),
  );
  fireEvent.click(screen.getByRole('checkbox', { name: copy.confirm }));
  fireEvent.click(screen.getByRole('button', { name: copy.save }));
  await screen.findByText(copy.uncertain);
  expect(screen.getByLabelText(copy.titleLabel)).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: copy.retryOperation }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[0]?.[0]).toEqual(save.mock.calls[1]?.[0]);
  expect(save.mock.calls[0]?.[0].input.starts_at).toBe(scheduleInput.starts_at);
});
it('preserves conflict drafts without silently rebasing or overwriting', async () => {
  const save = vi.fn().mockResolvedValue({ ok: false, code: 'CONFLICT' });
  render(
    wrapper(
      <ScheduleEditor
        event={adminSchedule}
        initial={scheduleInput}
        pendingOperation={{ current: null }}
        busy={false}
        onSave={save}
        onCancel={vi.fn()}
      />,
    ),
  );
  fireEvent.change(screen.getByLabelText(copy.titleLabel), {
    target: { value: '보존할 수정 내용' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: copy.confirm }));
  fireEvent.click(screen.getByRole('button', { name: copy.save }));
  await screen.findByText(copy.conflictHint);
  expect(screen.getByLabelText(copy.titleLabel)).toHaveValue(
    '보존할 수정 내용',
  );
  expect(screen.getByRole('button', { name: copy.save })).toBeDisabled();
  expect(save).toHaveBeenCalledTimes(1);
});
it('requires explicit publish confirmation and prevents repeat clicks while dialog is open', async () => {
  const save = vi.fn().mockResolvedValue(ok(adminSchedule));
  render(
    wrapper(
      <ScheduleEditor
        event={adminSchedule}
        initial={{ ...scheduleInput, status: 'published' }}
        pendingOperation={{ current: null }}
        busy={false}
        onSave={save}
        onCancel={vi.fn()}
      />,
    ),
  );
  fireEvent.click(screen.getByRole('checkbox', { name: copy.confirm }));
  const saveButton = screen.getByRole('button', { name: copy.save });
  fireEvent.click(saveButton);
  fireEvent.click(saveButton);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(
    within(dialog).getByRole('button', { name: copy.publishCancel }),
  );
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: copy.save }));
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: copy.publishConfirm,
    }),
  );
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]?.[0].confirmed).toBe(true);
});
it('requires delete confirmation and reuses exact delete receipt on uncertain retry', async () => {
  const remove = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
    .mockResolvedValueOnce(ok({ id: adminSchedule.id, deleted: true }));
  render(
    wrapper(
      <AdminScheduleDelete
        event={adminSchedule}
        pendingOperation={{ current: null as AdminScheduleDeleteInput | null }}
        busy={false}
        onDelete={remove}
      />,
    ),
  );
  expect(
    screen.getByRole('button', { name: copy.deleteAction }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: copy.deleteConfirm }));
  fireEvent.click(screen.getByRole('button', { name: copy.deleteAction }));
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: copy.deleteDialogConfirm,
    }),
  );
  await screen.findByText(copy.uncertain);
  fireEvent.click(screen.getByRole('button', { name: copy.retryOperation }));
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
  expect(remove.mock.calls[0]?.[0]).toEqual(remove.mock.calls[1]?.[0]);
});
it('retains uncertain create operation across hidden/visible authority revalidation', async () => {
  mock.save
    .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
    .mockResolvedValueOnce(ok(adminSchedule));
  window.history.replaceState({}, '', adminSchedulePath('new'));
  render(wrapper(<AdminScheduleCreateScreen />));
  await screen.findByLabelText(copy.titleLabel);
  fireEvent.click(
    screen.getByRole('radio', {
      name: `${scheduleEvent.artist_name} · ${scheduleEvent.artist_slug} · 활동 중`,
    }),
  );
  fireEvent.change(screen.getByLabelText(copy.titleLabel), {
    target: { value: '새 공식 행사' },
  });
  fireEvent.change(screen.getByLabelText(copy.startDate), {
    target: { value: '2026-10-25' },
  });
  fireEvent.change(screen.getByLabelText(copy.startTime), {
    target: { value: '18:00' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: copy.confirm }));
  fireEvent.click(screen.getByRole('button', { name: copy.createSave }));
  await screen.findByText(copy.uncertain);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'hidden',
  });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(screen.queryByLabelText(copy.titleLabel)).not.toBeInTheDocument();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await screen.findByRole('button', { name: copy.retryOperation });
  expect(screen.getByLabelText(copy.titleLabel)).toHaveValue('새 공식 행사');
  fireEvent.click(screen.getByRole('button', { name: copy.retryOperation }));
  await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2));
  expect(mock.save.mock.calls[0]?.[0]).toEqual(mock.save.mock.calls[1]?.[0]);
  expect(mock.push).toHaveBeenCalledWith(adminSchedulePath(adminSchedule.id));
});
it('clears admin data on authority loss after focus', async () => {
  window.history.replaceState({}, '', adminSchedulePath(adminSchedule.id));
  render(wrapper(<AdminScheduleDetailScreen id={adminSchedule.id} />));
  await screen.findByLabelText(copy.titleLabel);
  mock.adminDetail.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
  act(() => window.dispatchEvent(new Event('focus')));
  await screen.findByText(copy.errors.FORBIDDEN);
  expect(screen.queryByLabelText(copy.titleLabel)).not.toBeInTheDocument();
  expect(screen.getAllByRole('alert')).toHaveLength(1);
});
it('routes error retry through current server refresh', () => {
  render(wrapper(<ScheduleErrorScreen code="SETUP_NOT_READY" />));
  fireEvent.click(screen.getByRole('button', { name: messages.ui.retry }));
  expect(mock.refresh).toHaveBeenCalledTimes(1);
});
it('retries an acknowledged-late create after interrupted in-flight response without a new operation', async () => {
  let resolveFirst: (value: unknown) => void = () => undefined;
  mock.save
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockResolvedValueOnce(ok(adminSchedule));
  window.history.replaceState({}, '', adminSchedulePath('new'));
  render(wrapper(<AdminScheduleCreateScreen />));
  await screen.findByLabelText(copy.titleLabel);
  fireEvent.click(
    screen.getByRole('radio', {
      name: `${scheduleEvent.artist_name} · ${scheduleEvent.artist_slug} · 활동 중`,
    }),
  );
  fireEvent.change(screen.getByLabelText(copy.titleLabel), {
    target: { value: '중단된 요청 행사' },
  });
  fireEvent.change(screen.getByLabelText(copy.startDate), {
    target: { value: '2026-10-25' },
  });
  fireEvent.change(screen.getByLabelText(copy.startTime), {
    target: { value: '18:00' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: copy.confirm }));
  fireEvent.click(screen.getByRole('button', { name: copy.createSave }));
  await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(1));
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'hidden',
  });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await screen.findByRole('button', { name: copy.retryOperation });
  await act(async () => {
    resolveFirst(ok(adminSchedule));
  });
  expect(mock.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: copy.retryOperation }));
  await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2));
  expect(mock.save.mock.calls[0]?.[0]).toEqual(mock.save.mock.calls[1]?.[0]);
  expect(mock.push).toHaveBeenCalledExactlyOnceWith(
    adminSchedulePath(adminSchedule.id),
  );
});
it('replays a pending deletion after fresh authorized detail reports it already absent', async () => {
  mock.remove
    .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
    .mockResolvedValueOnce(ok({ id: adminSchedule.id, deleted: true }));
  window.history.replaceState({}, '', adminSchedulePath(adminSchedule.id));
  render(wrapper(<AdminScheduleDetailScreen id={adminSchedule.id} />));
  await screen.findByLabelText(copy.titleLabel);
  fireEvent.click(screen.getByRole('checkbox', { name: copy.deleteConfirm }));
  fireEvent.click(screen.getByRole('button', { name: copy.deleteAction }));
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: copy.deleteDialogConfirm,
    }),
  );
  await screen.findByText(copy.uncertain);
  mock.adminDetail.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
  act(() => window.dispatchEvent(new Event('focus')));
  await screen.findByRole('button', { name: copy.retryOperation });
  expect(screen.queryByLabelText(copy.titleLabel)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: copy.retryOperation }));
  await waitFor(() => expect(mock.remove).toHaveBeenCalledTimes(2));
  expect(mock.remove.mock.calls[0]?.[0]).toEqual(
    mock.remove.mock.calls[1]?.[0],
  );
  expect(mock.push).toHaveBeenCalledWith(routes.adminSchedules);
});
it('cross-actor403 clears a pending create before another mounted administrator can render the form', async () => {
  const actorA = '3b0d4317-b739-4670-a0ce-02173f1e8110';
  const actorB = '3b0d4317-b739-4670-a0ce-02173f1e8111';
  mock.save.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  window.history.replaceState({}, '', adminSchedulePath('new'));
  const view = render(wrapper(<AdminScheduleCreateScreen actorKey={actorA} />));
  await screen.findByLabelText(copy.titleLabel);
  expect(mock.artists).toHaveBeenLastCalledWith(
    1,
    expect.any(AbortSignal),
    actorA,
  );
  fireEvent.click(
    screen.getByRole('radio', {
      name: `${scheduleEvent.artist_name} · ${scheduleEvent.artist_slug} · 활동 중`,
    }),
  );
  fireEvent.change(screen.getByLabelText(copy.titleLabel), {
    target: { value: '이전 계정의 미확정 초안' },
  });
  fireEvent.change(screen.getByLabelText(copy.startDate), {
    target: { value: '2026-10-25' },
  });
  fireEvent.change(screen.getByLabelText(copy.startTime), {
    target: { value: '18:00' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: copy.confirm }));
  fireEvent.click(screen.getByRole('button', { name: copy.createSave }));
  await screen.findByText(copy.uncertain);
  expect(mock.save).toHaveBeenCalledWith(
    expect.any(Object),
    expect.any(AbortSignal),
    actorA,
  );
  mock.artists.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
  act(() => window.dispatchEvent(new Event('focus')));
  await screen.findByText(copy.errors.FORBIDDEN);
  expect(screen.queryByLabelText(copy.titleLabel)).not.toBeInTheDocument();
  view.rerender(wrapper(<AdminScheduleCreateScreen actorKey={actorB} />));
  await screen.findByLabelText(copy.titleLabel);
  expect(screen.getByLabelText(copy.titleLabel)).toHaveValue('');
  expect(
    screen.queryByRole('button', { name: copy.retryOperation }),
  ).not.toBeInTheDocument();
  expect(mock.artists).toHaveBeenLastCalledWith(
    1,
    expect.any(AbortSignal),
    actorB,
  );
  expect(mock.save).toHaveBeenCalledTimes(1);
});
it('loads canonically equivalent encoded month and UUID URLs, but never loads newer navigation with old props', async () => {
  const path = scheduleListPath('2026-10');
  window.history.replaceState({}, '', `${routes.schedules}?month=2026%2D10`);
  const rendered = render(
    wrapper(
      <SchedulesScreen
        query={{ month: '2026-10', cursor: null }}
        path={path}
      />,
    ),
  );
  await screen.findByTestId('schedule-calendar');
  expect(mock.list).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
  await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2));
  await screen.findByTestId('schedule-calendar');
  window.history.replaceState({}, '', scheduleListPath('2026-11'));
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  expect(screen.queryByTestId('schedule-calendar')).not.toBeInTheDocument();
  expect(mock.list).toHaveBeenCalledTimes(2);
  rendered.unmount();
  const detail = scheduleDetailPath(scheduleEvent.id, '2026-10');
  window.history.replaceState(
    {},
    '',
    `${routes.schedules}/${scheduleEvent.id.replaceAll('-', '%2D')}?month=2026%2D10`,
  );
  render(
    wrapper(
      <ScheduleDetailScreen
        id={scheduleEvent.id}
        month="2026-10"
        path={detail}
      />,
    ),
  );
  await screen.findByRole('heading', { name: scheduleEvent.title });
  expect(mock.detail).toHaveBeenCalledTimes(1);
});
it('distinguishes same-name artist choices using each unique visible slug', async () => {
  const another = {
    ...artist,
    id: '3b0d4317-b739-4670-a0ce-02173f1e8120',
    slug: 'same-name-other',
  };
  const save = vi.fn().mockResolvedValue(ok(adminSchedule));
  render(
    wrapper(
      <ScheduleEditor
        event={null}
        initial={{ ...scheduleInput, artist_id: '' }}
        initialArtists={{
          artists: [artist, another],
          has_more: false,
        }}
        pendingOperation={{ current: null }}
        busy={false}
        onSave={save}
        onCancel={vi.fn()}
      />,
    ),
  );
  const firstName = `${artist.name} · ${artist.slug} · 활동 중`;
  const secondName = `${another.name} · ${another.slug} · 활동 중`;
  expect(screen.getByRole('radio', { name: firstName })).toBeVisible();
  fireEvent.click(screen.getByRole('radio', { name: secondName }));
  expect(screen.getByRole('radio', { name: firstName })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: secondName })).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: copy.confirm }));
  fireEvent.click(screen.getByRole('button', { name: copy.createSave }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]?.[0].input.artist_id).toBe(another.id);
});
it.each(['restore', 'actor switch'] as const)(
  'retains page-two artist identity only for the bound pending create: %s',
  async (flow) => {
    const actorA = '3b0d4317-b739-4670-a0ce-02173f1e8110';
    const actorB = '3b0d4317-b739-4670-a0ce-02173f1e8111';
    const second = {
      ...artist,
      id: '3b0d4317-b739-4670-a0ce-02173f1e8120',
      slug: 'second-page-artist',
      name: '두 번째 목록 가수',
    };
    const selectedLabel = `${second.name} · ${second.slug} · 활동 중`;
    mock.artists
      .mockResolvedValue(ok({ artists: [artist], has_more: true }))
      .mockResolvedValueOnce(ok({ artists: [artist], has_more: true }))
      .mockResolvedValueOnce(ok({ artists: [second], has_more: false }));
    mock.save
      .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
      .mockResolvedValueOnce(
        ok({
          ...adminSchedule,
          artist_id: second.id,
          artist_slug: second.slug,
          artist_name: second.name,
        }),
      );
    window.history.replaceState({}, '', adminSchedulePath('new'));
    const rendered = render(
      wrapper(<AdminScheduleCreateScreen actorKey={actorA} />),
    );
    await screen.findByRole('button', { name: copy.artistNext });
    fireEvent.click(screen.getByRole('button', { name: copy.artistNext }));
    fireEvent.click(await screen.findByRole('radio', { name: selectedLabel }));
    fireEvent.change(screen.getByLabelText(copy.titleLabel), {
      target: { value: '두 번째 가수의 미확정 일정' },
    });
    fireEvent.change(screen.getByLabelText(copy.startDate), {
      target: { value: '2026-10-25' },
    });
    fireEvent.change(screen.getByLabelText(copy.startTime), {
      target: { value: '18:00' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: copy.confirm }));
    fireEvent.click(screen.getByRole('button', { name: copy.createSave }));
    await screen.findByText(copy.uncertain);
    if (flow === 'restore') {
      mock.artists.mockResolvedValue(ok({ artists: [artist], has_more: true }));
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      });
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      });
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      const restored = await screen.findByRole('radio', {
        name: selectedLabel,
      });
      expect(restored).toBeChecked();
      expect(restored).toBeDisabled();
      expect(
        screen.getByRole('button', { name: copy.artistNext }),
      ).toBeDisabled();
      expect(mock.save).toHaveBeenCalledTimes(1);
      fireEvent.click(
        screen.getByRole('button', { name: copy.retryOperation }),
      );
      await waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2));
      expect(mock.save.mock.calls[1]?.[0]).toEqual(
        mock.save.mock.calls[0]?.[0],
      );
      expect(mock.save.mock.calls[1]?.[0].input.artist_id).toBe(second.id);
    } else {
      mock.artists.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
      act(() => window.dispatchEvent(new Event('focus')));
      await screen.findByText(copy.errors.FORBIDDEN);
      expect(
        screen.queryByRole('radio', { name: selectedLabel }),
      ).not.toBeInTheDocument();
      mock.artists.mockResolvedValue(
        ok({ artists: [artist], has_more: false }),
      );
      rendered.rerender(
        wrapper(<AdminScheduleCreateScreen actorKey={actorB} />),
      );
      await screen.findByLabelText(copy.titleLabel);
      expect(
        screen.queryByRole('radio', { name: selectedLabel }),
      ).not.toBeInTheDocument();
      expect(screen.getByLabelText(copy.titleLabel)).toHaveValue('');
      expect(
        screen.queryByRole('button', { name: copy.retryOperation }),
      ).not.toBeInTheDocument();
      expect(mock.save).toHaveBeenCalledTimes(1);
    }
  },
);
