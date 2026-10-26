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
import { CommunityReportPanel } from '@/components/community-moderation/CommunityReportPanel';
import { AdminModerationScreen } from '@/components/community-moderation/AdminModerationScreen';
import { ModerationNoticesScreen } from '@/components/community-moderation/ModerationNoticesScreen';
import { DialogProvider } from '@/components/ui/DialogProvider';
import type { CommunityError } from '@/config/community-posts';
import type { ModerationTarget } from '@/config/community-moderation';
import { communityPostPath, routes } from '@/config/routes';
import messages from '@/messages/ko.json';
import {
  moderationActor,
  moderationOther,
  moderationTarget,
  moderationContext,
  moderationReport,
  moderationQueue,
  moderationNotices,
  moderationReported,
  moderationResolved,
  moderationRestricted,
} from './community-moderation-fixtures';

const mock = vi.hoisted(() => ({
  context: vi.fn(),
  report: vi.fn(),
  queue: vi.fn(),
  resolve: vi.fn(),
  restrict: vi.fn(),
  notices: vi.fn(),
  closed: vi.fn(),
  reported: vi.fn(),
  lost: vi.fn(),
  busy: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@/client/community-moderation', () => ({
  fetchModerationContext: mock.context,
  reportCommunityTarget: mock.report,
  fetchModerationQueue: mock.queue,
  resolveModerationReport: mock.resolve,
  restrictModerationUser: mock.restrict,
  fetchModerationNotices: mock.notices,
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
const copy = messages.communityModeration;
const ok = <T,>(data: T) => ({ ok: true as const, data });
const path = communityPostPath('first-artist', moderationTarget.target_id);
const wrapper = (children: ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
    <DialogProvider>{children}</DialogProvider>
  </NextIntlClientProvider>
);
function Report({
  actorKey = moderationActor,
  target = moderationTarget,
  available = true,
  authorityError = null,
  currentPath = path,
}: {
  actorKey?: string;
  target?: ModerationTarget;
  available?: boolean;
  authorityError?: CommunityError | null;
  currentPath?: string;
}) {
  return (
    <CommunityReportPanel
      target={target}
      actorKey={actorKey}
      path={currentPath}
      available={available}
      authorityError={authorityError}
      onClose={mock.closed}
      onReported={mock.reported}
      onAccessLost={mock.lost}
      onBusyChange={mock.busy}
    />
  );
}
async function report() {
  window.history.replaceState(null, '', path);
  const view = render(wrapper(<Report />));
  await screen.findByLabelText(copy.reason);
  return view;
}
function fillReason(value = '확인 부탁드립니다.') {
  fireEvent.change(screen.getByLabelText(copy.reason), { target: { value } });
}
async function submitReport() {
  fillReason();
  fireEvent.click(screen.getByRole('button', { name: copy.submitReport }));
  await waitFor(() => expect(mock.report).toHaveBeenCalledTimes(1));
}
async function admin() {
  window.history.replaceState(null, '', routes.adminModeration);
  const view = render(
    wrapper(<AdminModerationScreen actorKey={moderationActor} />),
  );
  await screen.findByTestId('community-moderation-content');
  return view;
}
async function review() {
  fireEvent.click(screen.getByRole('button', { name: copy.review }));
  await screen.findByLabelText(copy.decisionReason);
}
function reason(value = '검토 결과에 따라 처리합니다.') {
  fireEvent.change(screen.getByLabelText(copy.decisionReason), {
    target: { value },
  });
}
async function confirm(action = copy.restore) {
  reason();
  fireEvent.click(screen.getByRole('button', { name: action }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: copy.confirm }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  mock.context.mockResolvedValue(ok(moderationContext));
  mock.report.mockResolvedValue(ok(moderationReported));
  mock.queue.mockResolvedValue(ok(moderationQueue));
  mock.resolve.mockResolvedValue(ok(moderationResolved));
  mock.restrict.mockResolvedValue(ok(moderationRestricted));
  mock.notices.mockResolvedValue(ok(moderationNotices));
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
});
it('reads actor-bound reporting policy only after opening the report panel', async () => {
  await report();
  expect(mock.context).toHaveBeenCalledWith(
    moderationTarget,
    expect.any(AbortSignal),
    moderationActor,
  );
  expect(screen.getByText('1000자 이내로 작성해 주세요.')).toBeVisible();
  expect(mock.report).not.toHaveBeenCalled();
});
it.each(['', '   ', '\u0000bad', 'a'.repeat(1001)])(
  'rejects an invalid or over-policy report reason %j',
  async (value) => {
    await report();
    fillReason(value);
    fireEvent.click(screen.getByRole('button', { name: copy.submitReport }));
    expect(screen.getByText(copy.invalidReason)).toBeVisible();
    expect(mock.report).not.toHaveBeenCalled();
  },
);
it('submits once with exact target and actor, and shows the private result inbox destination', async () => {
  await report();
  await submitReport();
  await screen.findByText(copy.reportSaved);
  expect(mock.report.mock.calls[0]![0]).toEqual({
    ...moderationTarget,
    operation_id: expect.any(String),
    reason: '확인 부탁드립니다.',
  });
  expect(mock.report.mock.calls[0]![2]).toBe(moderationActor);
  expect(mock.reported).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText(copy.reason)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: copy.inboxEntry })).toHaveAttribute(
    'href',
    routes.communityReports,
  );
});
it.each(['open', 'hidden', 'restored', 'deleted'] as const)(
  'shows the current immutable own-report status %s without another submit',
  async (status) => {
    mock.context.mockResolvedValue(
      ok({
        ...moderationContext,
        existing_report: { id: moderationReport.id, status },
      }),
    );
    window.history.replaceState(null, '', path);
    render(wrapper(<Report />));
    await screen.findByRole('status');
    expect(screen.getByRole('status')).toHaveTextContent(copy.statuses[status]);
    expect(screen.queryByLabelText(copy.reason)).not.toBeInTheDocument();
    expect(mock.report).not.toHaveBeenCalled();
  },
);
it.each(['FORBIDDEN', 'UNAUTHENTICATED'] as const)(
  'clears source access on context %s',
  async (code) => {
    mock.context.mockResolvedValue({ ok: false, code });
    window.history.replaceState(null, '', path);
    render(wrapper(<Report />));
    await waitFor(() => expect(mock.lost).toHaveBeenCalledWith(code));
    expect(screen.queryByLabelText(copy.reason)).not.toBeInTheDocument();
  },
);
it('keeps the identical unknown report request when the target becomes unavailable', async () => {
  mock.report.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  const view = await report();
  await submitReport();
  await screen.findByTestId('community-report-recovery');
  const input = mock.report.mock.calls[0]![0];
  view.rerender(
    wrapper(<Report available={false} authorityError="NOT_FOUND" />),
  );
  expect(screen.getByRole('button', { name: copy.close })).toBeDisabled();
  expect(screen.queryByLabelText(copy.reason)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: copy.retryOperation }));
  await screen.findByText(copy.reportSaved);
  expect(mock.report).toHaveBeenCalledTimes(2);
  expect(mock.report.mock.calls[1]![0]).toBe(input);
});
it.each(['FORBIDDEN', 'UNAUTHENTICATED'] as const)(
  'does not retain a private form or offer another submit after report write %s',
  async (code) => {
    mock.report.mockResolvedValueOnce({ ok: false, code });
    await report();
    await submitReport();
    await waitFor(() => expect(mock.lost).toHaveBeenCalledWith(code));
    expect(screen.queryByLabelText(copy.reason)).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('community-report-recovery'),
    ).not.toBeInTheDocument();
    expect(mock.reported).not.toHaveBeenCalled();
  },
);
it.each(['FORBIDDEN', 'UNAUTHENTICATED'] as const)(
  'forgets unknown report intent when parent authority becomes %s',
  async (code) => {
    mock.report.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    const view = await report();
    await submitReport();
    await screen.findByTestId('community-report-recovery');
    view.rerender(wrapper(<Report authorityError={code} />));
    await waitFor(() =>
      expect(
        screen.queryByTestId('community-report-recovery'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(copy.reason)).not.toBeInTheDocument();
  },
);
it('isolates unknown report requests from a changed account', async () => {
  mock.report.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  const view = await report();
  await submitReport();
  await screen.findByTestId('community-report-recovery');
  mock.context.mockResolvedValue(
    ok({ ...moderationContext, actor_id: moderationOther }),
  );
  view.rerender(wrapper(<Report actorKey={moderationOther} />));
  expect(await screen.findByLabelText(copy.reason)).toHaveValue('');
  expect(
    screen.queryByTestId('community-report-recovery'),
  ).not.toBeInTheDocument();
  expect(mock.report).toHaveBeenCalledTimes(1);
});
it('isolates a report draft from a changed target', async () => {
  const view = await report();
  fillReason('이전 대상의 비공개 사유');
  const target = {
    target_type: 'comment' as const,
    target_id: moderationReport.id,
  };
  mock.context.mockResolvedValue(ok({ ...moderationContext, ...target }));
  view.rerender(wrapper(<Report target={target} />));
  expect(await screen.findByLabelText(copy.reason)).toHaveValue('');
  expect(mock.report).not.toHaveBeenCalled();
});
it('closes an untouched report without sending anything', async () => {
  await report();
  fillReason();
  fireEvent.click(screen.getByRole('button', { name: copy.close }));
  expect(mock.closed).toHaveBeenCalledTimes(1);
  expect(mock.report).not.toHaveBeenCalled();
});
it('does not turn an acknowledged report into unknown outcome when a parent refresh throws', async () => {
  mock.reported.mockRejectedValueOnce(new Error('read failed'));
  await report();
  await submitReport();
  await screen.findByText(copy.reportSaved);
  expect(
    screen.queryByTestId('community-report-recovery'),
  ).not.toBeInTheDocument();
  expect(mock.report).toHaveBeenCalledTimes(1);
});
it('discards a late response after navigation and preserves only exact replay intent', async () => {
  const pending = deferred<ReturnType<typeof ok<typeof moderationReported>>>();
  mock.report.mockReturnValueOnce(pending.promise);
  await report();
  await submitReport();
  act(() => {
    window.history.pushState(null, '', routes.communityReports);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await act(async () => {
    pending.resolve(ok(moderationReported));
  });
  expect(screen.queryByText(copy.reportSaved)).not.toBeInTheDocument();
  expect(mock.reported).not.toHaveBeenCalled();
  expect(screen.getByTestId('community-report-recovery')).toBeVisible();
});
it('renders actor-bound admin report context and opens the selected target review', async () => {
  await admin();
  expect(mock.queue).toHaveBeenCalledWith(
    null,
    expect.any(AbortSignal),
    moderationActor,
  );
  await review();
  expect(screen.getByText(moderationReport.target.title!)).toBeVisible();
  expect(screen.getByText(moderationReport.target.body)).toBeVisible();
  expect(screen.getByText('작성자: 다정한 팬')).toBeVisible();
});
it('requires a valid decision reason before confirmation', async () => {
  await admin();
  await review();
  fireEvent.click(screen.getByRole('button', { name: copy.restore }));
  expect(screen.getByText(copy.invalidReason)).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mock.resolve).not.toHaveBeenCalled();
});
it('cancels admin confirmation without applying any decision', async () => {
  await admin();
  await review();
  reason();
  fireEvent.click(screen.getByRole('button', { name: copy.restore }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: copy.cancel }));
  expect(mock.resolve).not.toHaveBeenCalled();
});
it.each(['restore', 'delete'] as const)(
  'applies confirmed %s with the selected target revision and immutable operation',
  async (decision) => {
    mock.resolve.mockResolvedValue(ok({ ...moderationResolved, decision }));
    await admin();
    await review();
    await confirm(copy[decision]);
    await screen.findByText(copy.saved);
    expect(mock.resolve).toHaveBeenCalledTimes(1);
    expect(mock.resolve.mock.calls[0]![0]).toEqual({
      operation_id: expect.any(String),
      report_id: moderationReport.id,
      expected_revision: moderationReport.target.revision,
      decision,
      reason: '검토 결과에 따라 처리합니다.',
      confirmed: true,
    });
    expect(mock.resolve.mock.calls[0]![2]).toBe(moderationActor);
  },
);
it('keeps exact unknown decision recovery even if queue refresh cannot find the content', async () => {
  mock.resolve.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  await admin();
  await review();
  await confirm();
  await screen.findByTestId('community-moderation-recovery');
  const input = mock.resolve.mock.calls[0]![0];
  mock.queue.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
  fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
  await waitFor(() =>
    expect(
      screen.queryByTestId('community-moderation-review'),
    ).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole('button', { name: copy.retryOperation }));
  await screen.findByText(copy.saved);
  expect(mock.resolve.mock.calls[1]![0]).toBe(input);
});
it.each(['FORBIDDEN', 'UNAUTHENTICATED'] as const)(
  'erases admin review and recovery when write authority is %s',
  async (code) => {
    mock.resolve.mockResolvedValueOnce({ ok: false, code });
    await admin();
    await review();
    await confirm();
    await waitFor(() =>
      expect(
        screen.queryByTestId('community-moderation-review'),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByText(moderationReport.target.body),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('community-moderation-recovery'),
    ).not.toBeInTheDocument();
  },
);
it('cancels a confirmation when focus revalidates the selected snapshot', async () => {
  await admin();
  await review();
  reason();
  fireEvent.click(screen.getByRole('button', { name: copy.restore }));
  await screen.findByRole('dialog');
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(mock.resolve).not.toHaveBeenCalled();
});
it('clears an unknown admin operation on account replacement', async () => {
  mock.resolve.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  const view = await admin();
  await review();
  await confirm();
  await screen.findByTestId('community-moderation-recovery');
  mock.queue.mockResolvedValue(
    ok({ ...moderationQueue, actor_id: moderationOther }),
  );
  view.rerender(wrapper(<AdminModerationScreen actorKey={moderationOther} />));
  await screen.findByTestId('community-moderation-content');
  expect(
    screen.queryByTestId('community-moderation-recovery'),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId('community-moderation-review'),
  ).not.toBeInTheDocument();
});
it('requires a future restriction end and a reason', async () => {
  await admin();
  await review();
  fireEvent.click(screen.getByRole('button', { name: copy.restrict }));
  expect(screen.getByText(copy.invalidRestriction)).toBeVisible();
  expect(mock.restrict).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('submits an explicitly confirmed KST restriction with original owner CAS timestamp', async () => {
  await admin();
  await review();
  fireEvent.change(screen.getByLabelText(copy.restrictionReason), {
    target: { value: '반복 위반 사유' },
  });
  fireEvent.change(screen.getByLabelText(copy.restrictionDate), {
    target: { value: '2099-11-01' },
  });
  fireEvent.change(screen.getByLabelText(copy.restrictionTime), {
    target: { value: '00:00' },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.restrict }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: copy.confirm }));
  await screen.findByText(copy.restrictionSaved);
  expect(mock.restrict.mock.calls[0]![0]).toEqual({
    operation_id: expect.any(String),
    user_id: moderationOther,
    expected_updated_at: moderationReport.target.owner.updated_at,
    restricted: true,
    until: '2099-10-31T15:00:00.000Z',
    reason: '반복 위반 사유',
    confirmed: true,
  });
});
it('distinguishes expired restriction settings and clears them without inventing another expiry', async () => {
  mock.queue.mockResolvedValue(
    ok({
      ...moderationQueue,
      reports: [
        {
          ...moderationReport,
          target: {
            ...moderationReport.target,
            owner: {
              ...moderationReport.target.owner,
              is_restricted: true,
              restricted_until: '2000-01-01T00:00:00Z',
            },
          },
        },
      ],
    }),
  );
  mock.restrict.mockResolvedValue(
    ok({
      ...moderationRestricted,
      is_restricted: false,
      restricted_until: null,
    }),
  );
  await admin();
  await review();
  expect(screen.getByText(copy.restrictionExpired)).toBeVisible();
  fireEvent.change(screen.getByLabelText(copy.restrictionReason), {
    target: { value: '종료된 설정 정리' },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.unrestrict }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: copy.confirm }));
  await screen.findByText(copy.restrictionSaved);
  expect(mock.restrict.mock.calls[0]![0]).toMatchObject({
    restricted: false,
    until: null,
    reason: '종료된 설정 정리',
  });
});
it('does not show restriction controls for nonrestrictable accounts', async () => {
  mock.queue.mockResolvedValue(
    ok({
      ...moderationQueue,
      reports: [
        {
          ...moderationReport,
          target: {
            ...moderationReport.target,
            owner: { ...moderationReport.target.owner, can_restrict: false },
          },
        },
      ],
    }),
  );
  await admin();
  await review();
  expect(screen.getByText(copy.cannotRestrict)).toBeVisible();
  expect(
    screen.queryByLabelText(copy.restrictionReason),
  ).not.toBeInTheDocument();
});
it('does not reveal deleted original body or offer restoration from a terminal report', async () => {
  mock.queue.mockResolvedValue(
    ok({
      ...moderationQueue,
      reports: [
        {
          ...moderationReport,
          status: 'deleted',
          resolved_at: moderationReport.created_at,
          target: {
            ...moderationReport.target,
            deleted_at: moderationReport.created_at,
          },
        },
      ],
    }),
  );
  await admin();
  fireEvent.click(screen.getByRole('button', { name: copy.review }));
  await screen.findByTestId('community-moderation-review');
  expect(screen.getByText(copy.deletedTarget)).toBeVisible();
  expect(
    screen.queryByText(moderationReport.target.body),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: copy.restore }),
  ).not.toBeInTheDocument();
});
it('shows an own-report inbox without original content, report reasons, author identity or external delivery claims', async () => {
  window.history.replaceState(null, '', routes.communityReports);
  render(wrapper(<ModerationNoticesScreen actorKey={moderationActor} />));
  await screen.findByTestId('community-report-notices');
  expect(screen.getByText(copy.noticeRestored)).toBeVisible();
  expect(mock.notices).toHaveBeenCalledWith(
    null,
    expect.any(AbortSignal),
    moderationActor,
  );
  expect(screen.queryByText(moderationReport.reason)).not.toBeInTheDocument();
  expect(
    screen.queryByText(moderationReport.target.body),
  ).not.toBeInTheDocument();
});
it('invalidates own inbox data on a denied focus revalidation', async () => {
  window.history.replaceState(null, '', routes.communityReports);
  render(wrapper(<ModerationNoticesScreen actorKey={moderationActor} />));
  await screen.findByTestId('community-report-notices');
  mock.notices.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() =>
    expect(
      screen.queryByTestId('community-report-notices'),
    ).not.toBeInTheDocument(),
  );
});
it('shows an empty inbox honestly and does not invent a delivery or read action', async () => {
  mock.notices.mockResolvedValue(ok({ ...moderationNotices, notices: [] }));
  window.history.replaceState(null, '', routes.communityReports);
  render(wrapper(<ModerationNoticesScreen actorKey={moderationActor} />));
  expect(await screen.findByText(copy.emptyNotices)).toBeVisible();
  expect(screen.queryByText(copy.noticeRestored)).not.toBeInTheDocument();
});

it('resets immutable report intent when the reusable host route changes', async () => {
  mock.report.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  const view = await report();
  await submitReport();
  await screen.findByTestId('community-report-recovery');
  window.history.replaceState(null, '', routes.communityReports);
  view.rerender(wrapper(<Report currentPath={routes.communityReports} />));
  expect(await screen.findByLabelText(copy.reason)).toHaveValue('');
  expect(
    screen.queryByTestId('community-report-recovery'),
  ).not.toBeInTheDocument();
  expect(mock.report).toHaveBeenCalledTimes(1);
});
it('discards the stale admin revision after conflict until a fresh queue read', async () => {
  mock.resolve.mockResolvedValueOnce({ ok: false, code: 'CONFLICT' });
  await admin();
  await review();
  await confirm();
  await waitFor(() =>
    expect(
      screen.queryByTestId('community-moderation-review'),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByTestId('community-moderation-content'),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId('community-moderation-recovery'),
  ).not.toBeInTheDocument();
});
