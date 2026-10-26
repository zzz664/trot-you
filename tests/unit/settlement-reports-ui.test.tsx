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
import { SettlementReportsScreen } from '@/components/settlement-reports/SettlementReportsScreen';
import { SettlementReportsErrorScreen } from '@/components/settlement-reports/SettlementReportsErrorScreen';
import { SettlementReportsEntry } from '@/components/settlement-reports/SettlementReportsEntry';
import type {
  SettlementReportEnvelope,
  SettlementReportMode,
} from '@/config/settlement-reports';
import { settlementReportsPath, routes } from '@/config/routes';
import messages from '@/messages/ko.json';
import {
  confirmedEnvelope,
  reportActor,
  reportEnvelope,
  reportOther,
  reportQuery,
} from './settlement-reports-ui-fixtures';
const mock = vi.hoisted(() => ({
  read: vi.fn(),
  calculate: vi.fn(),
  confirm: vi.fn(),
  export: vi.fn(),
  navigate: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  createUrl: vi.fn(),
  revokeUrl: vi.fn(),
}));
vi.mock('@/client/settlement-reports', () => ({
  fetchSettlementReport: mock.read,
  calculateSettlementReport: mock.calculate,
  confirmSettlementReport: mock.confirm,
  exportSettlementReport: mock.export,
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
const copy = messages.settlementReports;
const path = settlementReportsPath(reportQuery);
const ok = <T,>(data: T) => ({ ok: true as const, data });
const wrap = (child: ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
    {child}
  </NextIntlClientProvider>
);
const element = (
  actorKey = reportActor,
  mode: SettlementReportMode = 'admin',
  target = path,
) =>
  wrap(
    <SettlementReportsScreen
      actorKey={actorKey}
      mode={mode}
      query={reportQuery}
      artistId={reportQuery.artistId}
      month={reportQuery.month}
      path={target}
    />,
  );
const content = () => screen.queryByTestId('settlement-report-content');
const button = (name: string) => screen.getByRole('button', { name });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function open(data = reportEnvelope) {
  mock.read.mockResolvedValueOnce(ok(data));
  const view = render(
    element(
      reportActor,
      data.actorRole,
      settlementReportsPath(reportQuery, data.actorRole === 'artist'),
    ),
  );
  await screen.findByTestId('settlement-report-content');
  return view;
}
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  mock.read.mockResolvedValue(ok(reportEnvelope));
  mock.calculate.mockResolvedValue(
    ok({
      ...reportEnvelope,
      report: { ...reportEnvelope.report!, revision: reportOther },
    }),
  );
  mock.confirm.mockResolvedValue(ok(confirmedEnvelope()));
  mock.export.mockResolvedValue(
    ok({
      blob: new Blob(['xlsx']),
      filename: `settlement-${reportEnvelope.report!.id}.xlsx`,
    }),
  );
  mock.createUrl.mockReturnValue('blob:fictional-report');
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: mock.createUrl,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: mock.revokeUrl,
  });
  window.history.replaceState(null, '', path);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
});
it.each(['normal', 'large', 'xlarge'])(
  'renders escaped names and exact stored values at %s without precision conversion',
  async (scale) => {
    document.documentElement.dataset.fontScale = scale;
    await open();
    expect(mock.read).toHaveBeenCalledWith(
      reportQuery,
      'admin',
      expect.any(AbortSignal),
      reportActor,
    );
    expect(
      screen.getByRole('heading', { name: reportEnvelope.artist.name }),
    ).toBeVisible();
    expect(document.querySelector('가수')).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-settlement-value="vatKrw"]'),
    ).toHaveTextContent(reportEnvelope.report!.vatKrw);
    expect(
      document.querySelector('[data-settlement-value="finalAmountKrw"]'),
    ).toHaveTextContent(reportEnvelope.report!.finalAmountKrw);
    expect(screen.getByText(copy.precisionHint)).toBeVisible();
    expect(screen.getByText(copy.policyHint)).toBeVisible();
    expect(screen.getByText(copy.privacy)).toBeVisible();
    expect(mock.confirm).not.toHaveBeenCalled();
  },
);
it('shows exact integer strings larger than Number.MAX_SAFE_INTEGER unchanged', async () => {
  await open({
    ...reportEnvelope,
    report: {
      ...reportEnvelope.report!,
      grossKrw: '9007199254740993123456789',
      finalAmountKrw: '9007199254740993',
    },
  });
  expect(
    document.querySelector('[data-settlement-value="grossKrw"]'),
  ).toHaveTextContent('9007199254740993123456789');
  expect(
    document.querySelector('[data-settlement-value="finalAmountKrw"]'),
  ).toHaveTextContent('9007199254740993');
});
it('empty admin snapshot permits explicit initial CAS calculation only', async () => {
  await open({ ...reportEnvelope, report: null });
  expect(screen.getByText(copy.empty)).toBeVisible();
  fireEvent.click(button(copy.calculate));
  await screen.findByText(copy.draft);
  expect(mock.calculate).toHaveBeenCalledWith(
    { ...reportQuery, expectedRevision: null },
    expect.any(AbortSignal),
    reportActor,
  );
  expect(mock.confirm).not.toHaveBeenCalled();
});
it('recalculation uses displayed revision, hides draft and suppresses duplicate requests synchronously', async () => {
  await open();
  const d = deferred<ReturnType<typeof ok<SettlementReportEnvelope>>>();
  mock.calculate.mockReturnValueOnce(d.promise);
  const calculate = button(copy.recalculate);
  fireEvent.click(calculate);
  fireEvent.click(calculate);
  expect(content()).not.toBeInTheDocument();
  expect(mock.calculate).toHaveBeenCalledOnce();
  expect(mock.calculate).toHaveBeenCalledWith(
    { ...reportQuery, expectedRevision: reportEnvelope.report!.revision },
    expect.any(AbortSignal),
    reportActor,
  );
  await act(async () => d.resolve(ok(reportEnvelope)));
  expect(content()).toBeInTheDocument();
});
it('review needs explicit acknowledgement and Cancel never confirms or changes history', async () => {
  await open();
  fireEvent.click(button(copy.review));
  expect(screen.getByRole('heading', { name: copy.reviewTitle })).toHaveFocus();
  expect(button(copy.confirm)).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: copy.reviewCheck }));
  expect(button(copy.confirm)).toBeEnabled();
  fireEvent.click(button(copy.cancel));
  expect(
    screen.queryByTestId('settlement-report-review'),
  ).not.toBeInTheDocument();
  expect(mock.confirm).not.toHaveBeenCalled();
  expect(mock.push).not.toHaveBeenCalled();
  fireEvent.click(button(copy.review));
  expect(
    screen.getByRole('checkbox', { name: copy.reviewCheck }),
  ).not.toBeChecked();
});
it('confirmation sends exactly reviewed revision once and locked result exposes no mutation buttons', async () => {
  await open();
  fireEvent.click(button(copy.review));
  fireEvent.click(screen.getByRole('checkbox', { name: copy.reviewCheck }));
  const d = deferred<ReturnType<typeof ok<SettlementReportEnvelope>>>();
  mock.confirm.mockReturnValueOnce(d.promise);
  const confirm = button(copy.confirm);
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(content()).not.toBeInTheDocument();
  expect(mock.confirm).toHaveBeenCalledExactlyOnceWith(
    {
      reportId: reportEnvelope.report!.id,
      expectedRevision: reportEnvelope.report!.revision,
    },
    expect.any(AbortSignal),
    reportActor,
  );
  await act(async () => d.resolve(ok(confirmedEnvelope())));
  expect(screen.getByText(copy.locked)).toBeVisible();
  expect(
    screen.queryByRole('button', { name: copy.recalculate }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: copy.review }),
  ).not.toBeInTheDocument();
});
it.each([
  'REVISION_CONFLICT',
  'DRAFT_STALE',
  'FORBIDDEN',
  'UNAVAILABLE',
] as const)(
  'failed confirmation %s clears report and review, never automatically retries mutation',
  async (code) => {
    await open();
    mock.confirm.mockResolvedValueOnce({ ok: false, code });
    fireEvent.click(button(copy.review));
    fireEvent.click(screen.getByRole('checkbox', { name: copy.reviewCheck }));
    fireEvent.click(button(copy.confirm));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent(copy.errors[code]);
    expect(content()).not.toBeInTheDocument();
    fireEvent.click(button(messages.ui.retry));
    await screen.findByTestId('settlement-report-content');
    expect(mock.confirm).toHaveBeenCalledOnce();
    expect(mock.read).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByTestId('settlement-report-review'),
    ).not.toBeInTheDocument();
  },
);
it('artist confirmed view never exposes calculation, confirmation or source export', async () => {
  window.history.replaceState(
    null,
    '',
    settlementReportsPath(reportQuery, true),
  );
  await open(confirmedEnvelope('artist'));
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    copy.artistTitle,
  );
  for (const label of [
    copy.calculate,
    copy.recalculate,
    copy.review,
    copy.confirm,
    copy.export,
  ])
    expect(
      screen.queryByRole('button', { name: label }),
    ).not.toBeInTheDocument();
  expect(screen.queryByText(copy.exportHint)).not.toBeInTheDocument();
});
it('artist absence is not fabricated zero and unconfirmed returned data is rejected', async () => {
  window.history.replaceState(
    null,
    '',
    settlementReportsPath(reportQuery, true),
  );
  await open({ ...reportEnvelope, actorRole: 'artist', report: null });
  expect(screen.getByText(copy.emptyArtist)).toBeVisible();
  mock.read.mockResolvedValueOnce(
    ok({ ...reportEnvelope, actorRole: 'artist' }),
  );
  fireEvent.click(button(copy.refresh));
  await screen.findByRole('alert');
  expect(content()).not.toBeInTheDocument();
});
it('bare selector performs no private read and invalid input performs no navigation', async () => {
  window.history.replaceState(null, '', routes.adminSettlements);
  render(
    wrap(
      <SettlementReportsScreen
        actorKey={reportActor}
        mode="admin"
        query={null}
        artistId=""
        month={reportQuery.month}
        path={routes.adminSettlements}
      />,
    ),
  );
  await act(async () => undefined);
  expect(mock.read).not.toHaveBeenCalled();
  fireEvent.submit(screen.getByRole('form', { name: copy.filterTitle }));
  expect(screen.getByRole('alert')).toHaveTextContent(copy.formError);
  expect(mock.push).not.toHaveBeenCalled();
});
it('new exact selector clears report and guards repeated URL navigation', async () => {
  await open();
  fireEvent.change(screen.getByLabelText(copy.month), {
    target: { value: '2026-08-01' },
  });
  const form = screen.getByRole('form', { name: copy.filterTitle });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(mock.push).toHaveBeenCalledExactlyOnceWith(
    settlementReportsPath({ ...reportQuery, month: '2026-08-01' }),
  );
  expect(content()).not.toBeInTheDocument();
});
it('same exact selector refreshes without duplicate history and clears pending review', async () => {
  await open();
  fireEvent.click(button(copy.review));
  fireEvent.submit(screen.getByRole('form', { name: copy.filterTitle }));
  await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(2));
  expect(mock.push).not.toHaveBeenCalled();
  expect(
    screen.queryByTestId('settlement-report-review'),
  ).not.toBeInTheDocument();
});
it('export is one current revision-bound request then revocable nonprefetched download', async () => {
  await open();
  const d = deferred<ReturnType<typeof ok<{ blob: Blob; filename: string }>>>();
  mock.export.mockReturnValueOnce(d.promise);
  const prepare = button(copy.export);
  fireEvent.click(prepare);
  fireEvent.click(prepare);
  expect(content()).not.toBeInTheDocument();
  expect(mock.export).toHaveBeenCalledExactlyOnceWith(
    {
      reportId: reportEnvelope.report!.id,
      expectedRevision: reportEnvelope.report!.revision,
    },
    expect.any(AbortSignal),
    reportActor,
  );
  await act(async () =>
    d.resolve(
      ok({ blob: new Blob(['xlsx']), filename: 'settlement-fixture.xlsx' }),
    ),
  );
  const download = screen.getByRole('link', { name: copy.download });
  expect(download).toHaveAttribute('href', 'blob:fictional-report');
  expect(download).toHaveAttribute('download', 'settlement-fixture.xlsx');
  expect(download).toHaveAttribute('data-prefetch', 'false');
  fireEvent.click(button(copy.refresh));
  await screen.findByTestId('settlement-report-content');
  expect(mock.revokeUrl).toHaveBeenCalledWith('blob:fictional-report');
  expect(
    screen.queryByRole('link', { name: copy.download }),
  ).not.toBeInTheDocument();
});
it('failed export revocation never retains report or a download', async () => {
  await open();
  mock.export.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
  fireEvent.click(button(copy.export));
  await screen.findByRole('alert');
  expect(content()).not.toBeInTheDocument();
  expect(mock.createUrl).not.toHaveBeenCalled();
});
it('leaving during export aborts ownership and cannot create a stale workbook URL', async () => {
  await open();
  const d = deferred<ReturnType<typeof ok<{ blob: Blob; filename: string }>>>();
  mock.export.mockReturnValueOnce(d.promise);
  fireEvent.click(button(copy.export));
  const signal = mock.export.mock.calls[0]![1] as AbortSignal;
  fireEvent(window, new Event('pagehide'));
  await act(async () =>
    d.resolve(
      ok({ blob: new Blob(['xlsx']), filename: 'settlement-fixture.xlsx' }),
    ),
  );
  expect(signal.aborted).toBe(true);
  expect(mock.createUrl).not.toHaveBeenCalled();
  expect(content()).not.toBeInTheDocument();
});
it('actor replacement aborts old request and mismatched current identity cannot restore report', async () => {
  const old = deferred<ReturnType<typeof ok<SettlementReportEnvelope>>>();
  mock.read.mockReturnValueOnce(old.promise);
  const view = render(element());
  await waitFor(() => expect(mock.read).toHaveBeenCalledOnce());
  const signal = mock.read.mock.calls[0]![2] as AbortSignal;
  mock.read.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
  view.rerender(element(reportOther));
  await screen.findByRole('alert');
  await act(async () => old.resolve(ok(reportEnvelope)));
  expect(signal.aborted).toBe(true);
  expect(content()).not.toBeInTheDocument();
});
it.each(['actorId', 'month', 'artist'] as const)(
  'wrong returned %s cannot expose snapshot',
  async (field) => {
    mock.read.mockResolvedValueOnce(
      ok({
        ...reportEnvelope,
        [field]:
          field === 'actorId'
            ? reportOther
            : field === 'month'
              ? '2026-08-01'
              : { ...reportEnvelope.artist, id: reportOther },
      }),
    );
    render(element());
    await screen.findByRole('alert');
    expect(content()).not.toBeInTheDocument();
  },
);
it('hidden/pagehide clears snapshot; visible and persisted restore revalidate only reads', async () => {
  await open();
  fireEvent.click(button(copy.review));
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'hidden',
  });
  fireEvent(document, new Event('visibilitychange'));
  expect(content()).not.toBeInTheDocument();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  fireEvent(document, new Event('visibilitychange'));
  await screen.findByTestId('settlement-report-content');
  expect(
    screen.queryByTestId('settlement-report-review'),
  ).not.toBeInTheDocument();
  fireEvent(window, new Event('pagehide'));
  expect(content()).not.toBeInTheDocument();
  fireEvent(window, new PageTransitionEvent('pageshow', { persisted: true }));
  await screen.findByTestId('settlement-report-content');
  expect(mock.read).toHaveBeenCalledTimes(3);
  expect(mock.confirm).not.toHaveBeenCalled();
  expect(mock.calculate).not.toHaveBeenCalled();
});
it('Back clears immediately and browser restoration requires current authority', async () => {
  await open();
  fireEvent.click(button(copy.review));
  fireEvent.click(screen.getByRole('link', { name: copy.back }));
  expect(content()).not.toBeInTheDocument();
  expect(mock.navigate).toHaveBeenCalledWith(routes.admin);
  window.history.replaceState(null, '', routes.admin);
  fireEvent(window, new PopStateEvent('popstate'));
  expect(mock.read).toHaveBeenCalledOnce();
  window.history.replaceState(null, '', path);
  mock.read.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
  fireEvent(window, new PopStateEvent('popstate'));
  await screen.findByRole('alert');
  expect(content()).not.toBeInTheDocument();
});
it('focus refreshes authority, duplicate queries do not match, and unmount aborts', async () => {
  const view = await open();
  const d = deferred<ReturnType<typeof ok<SettlementReportEnvelope>>>();
  mock.read.mockReturnValueOnce(d.promise);
  fireEvent(window, new Event('focus'));
  const signal = mock.read.mock.calls.at(-1)![2] as AbortSignal;
  window.history.replaceState(null, '', `${path}&month=${reportQuery.month}`);
  fireEvent(window, new PopStateEvent('popstate'));
  await act(async () => d.resolve(ok(reportEnvelope)));
  expect(content()).not.toBeInTheDocument();
  expect(signal.aborted).toBe(true);
  view.unmount();
});
it('entry and fail-closed error screen preserve no-prefetch safe navigation', async () => {
  const view = render(
    wrap(
      <SettlementReportsEntry
        title={copy.title}
        description={copy.entryDescription}
        label={copy.entryOpen}
      />,
    ),
  );
  expect(screen.getByRole('link')).toHaveAttribute(
    'href',
    routes.adminSettlements,
  );
  expect(screen.getByRole('link')).toHaveAttribute('data-prefetch', 'false');
  view.rerender(
    wrap(<SettlementReportsErrorScreen code="SETUP_NOT_READY" mode="artist" />),
  );
  expect(within(screen.getByRole('main')).getByRole('alert')).toHaveTextContent(
    copy.errors.SETUP_NOT_READY,
  );
  fireEvent.click(button(messages.ui.retry));
  await waitFor(() => expect(mock.refresh).toHaveBeenCalledOnce());
  expect(screen.getByRole('link')).toHaveAttribute('href', routes.artist);
});
it('editing either selector immediately clears old financial actions and pending review', async () => {
  await open();
  fireEvent.click(button(copy.review));
  fireEvent.click(screen.getByRole('checkbox', { name: copy.reviewCheck }));
  fireEvent.change(screen.getByLabelText(copy.artistId), {
    target: { value: reportOther },
  });
  expect(content()).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: copy.confirm }),
  ).not.toBeInTheDocument();
  expect(mock.confirm).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(copy.artistId), {
    target: { value: reportQuery.artistId },
  });
  fireEvent.submit(screen.getByRole('form', { name: copy.filterTitle }));
  await screen.findByTestId('settlement-report-content');
  fireEvent.change(screen.getByLabelText(copy.month), {
    target: { value: '2026-08-01' },
  });
  expect(content()).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: copy.recalculate }),
  ).not.toBeInTheDocument();
});
it('a second pointer click from one gesture cannot activate the next post-calculation action', async () => {
  await open();
  fireEvent.click(button(copy.recalculate), { detail: 1 });
  await screen.findByTestId('settlement-report-content');
  fireEvent.click(button(copy.review), { detail: 2 });
  expect(
    screen.queryByTestId('settlement-report-review'),
  ).not.toBeInTheDocument();
  expect(mock.calculate).toHaveBeenCalledOnce();
  fireEvent.click(button(copy.review), { detail: 1 });
  expect(screen.getByTestId('settlement-report-review')).toBeVisible();
  fireEvent.click(button(copy.cancel), { detail: 1 });
  fireEvent.click(button(copy.recalculate), { detail: 2 });
  expect(mock.calculate).toHaveBeenCalledOnce();
  expect(mock.confirm).not.toHaveBeenCalled();
});
