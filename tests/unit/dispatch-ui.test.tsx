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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtistDispatch } from '@/components/artist-dispatch/ArtistDispatch';
import { DialogProvider } from '@/components/ui/DialogProvider';
import type { ComposeDraft } from '@/config/artist-compose';
import type {
  DispatchError,
  DispatchMessage,
  DispatchResult,
} from '@/config/message-dispatch';
import { artistComposePath, routes } from '@/config/routes';
import messages from '@/messages/ko.json';
import { composeUiDraft, deferred } from './compose-ui-fixtures';
import {
  dispatchUiIds as ids,
  dispatchUiMessage,
  dispatchUiPage,
} from './dispatch-ui-fixtures';
const mock = vi.hoisted(() => ({
  read: vi.fn(),
  submit: vi.fn(),
  cancel: vi.fn(),
  lock: vi.fn(),
  published: vi.fn(),
  lost: vi.fn(),
}));
vi.mock('@/client/dispatch', () => ({
  readDispatchPage: mock.read,
  submitDispatch: mock.submit,
  cancelDispatch: mock.cancel,
}));
const copy = messages.artistDispatch;
const slug = dispatchUiPage().artist.slug;
function subject(
  options: {
    draft?: ComposeDraft | null;
    disabled?: boolean;
    initialDispatchedId?: string;
  } = {},
) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
      <DialogProvider>
        <ArtistDispatch
          slug={slug}
          draft={options.draft === undefined ? composeUiDraft() : options.draft}
          disabled={options.disabled ?? false}
          {...(options.initialDispatchedId
            ? { initialDispatchedId: options.initialDispatchedId }
            : {})}
          onLock={mock.lock}
          onPublished={mock.published}
          onAccessLost={mock.lost}
        />
      </DialogProvider>
    </NextIntlClientProvider>
  );
}
const send = () => screen.getByRole('button', { name: copy.submit });
async function ready() {
  await waitFor(() => expect(send()).toBeEnabled());
}
async function confirmSend(user: ReturnType<typeof userEvent.setup>) {
  await user.click(send());
  await user.click(screen.getByRole('button', { name: copy.confirmSubmit }));
}
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  window.history.replaceState({}, '', artistComposePath(slug));
  mock.read.mockResolvedValue({ ok: true, data: dispatchUiPage() });
  mock.submit.mockResolvedValue({ ok: true, data: dispatchUiMessage() });
  mock.cancel.mockResolvedValue({
    ok: true,
    data: dispatchUiMessage({
      status: 'canceled',
      canceledAt: '2026-10-24T12:01:00Z',
      canCancel: false,
      notificationState: 'canceled',
    }),
  });
  mock.published.mockResolvedValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.fontScale;
});
describe('artist dispatch confirmation and history', () => {
  it.each(['normal', 'large', 'xlarge'])(
    'has explicit accessible in-app/queue distinctions at %s scale',
    async (scale) => {
      document.documentElement.dataset.fontScale = scale;
      render(subject());
      await ready();
      expect(screen.getByRole('region', { name: copy.title })).toBeVisible();
      expect(screen.getByText(copy.notice)).toBeVisible();
      expect(screen.getByText(copy.savedOnly)).toBeVisible();
      expect(screen.getByText(copy.empty)).toBeVisible();
      expect(mock.submit).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );
  it.each([
    { draft: null },
    { disabled: true },
    { draft: composeUiDraft({ pendingUploadIds: [ids.upload] }) },
  ])(
    'does not send unsaved, dirty/busy or incomplete-upload draft %j',
    async (options) => {
      render(subject(options));
      await waitFor(() => expect(screen.getByText(copy.empty)).toBeVisible());
      expect(send()).toBeDisabled();
      fireEvent.click(send());
      expect(mock.submit).not.toHaveBeenCalled();
    },
  );
  it('loads before enabling submission and offers inline read recovery', async () => {
    const waiting =
      deferred<DispatchResult<ReturnType<typeof dispatchUiPage>>>();
    mock.read.mockReturnValueOnce(waiting.promise);
    render(subject());
    expect(send()).toBeDisabled();
    expect(screen.getByText(copy.loading)).toBeVisible();
    await act(async () =>
      waiting.resolve({ ok: false, code: 'SETUP_NOT_READY' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      copy.errors.SETUP_NOT_READY,
    );
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: copy.refresh }));
    await ready();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it.each(['stay', 'close', 'escape'])(
    'dismisses %s confirmation without submitting or changing history',
    async (method) => {
      const user = userEvent.setup();
      render(subject());
      await ready();
      const path = window.location.href;
      await user.click(send());
      expect(screen.getByRole('dialog')).toHaveTextContent(
        copy.confirmImmediateTitle,
      );
      if (method === 'escape') await user.keyboard('{Escape}');
      else
        await user.click(
          screen.getByRole('button', {
            name: method === 'stay' ? copy.stay : messages.ui.close,
          }),
        );
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(mock.submit).not.toHaveBeenCalled();
      expect(window.location.href).toBe(path);
      expect(send()).toBeEnabled();
    },
  );
  it('confirms one immutable immediate request despite repeated clicks and distinguishes published vs queued', async () => {
    const waiting = deferred<DispatchResult<DispatchMessage>>();
    mock.submit.mockReturnValueOnce(waiting.promise);
    const user = userEvent.setup();
    render(subject());
    await ready();
    const submitButton = send();
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: copy.confirmSubmit }));
    expect(send()).toBeDisabled();
    fireEvent.click(send());
    expect(mock.submit).toHaveBeenCalledOnce();
    expect(mock.submit.mock.calls[0]![0]).toEqual({
      slug,
      messageId: ids.message,
      expectedRevision: 1,
      operationId: expect.any(String),
      scheduledAt: null,
      confirmed: true,
    });
    await act(async () =>
      waiting.resolve({ ok: true, data: dispatchUiMessage() }),
    );
    const receipt = screen.getByRole('region', { name: copy.receipt });
    expect(receipt).toHaveTextContent(copy.statuses.sent);
    expect(receipt).toHaveTextContent(copy.notifications.queued);
    expect(mock.published).toHaveBeenCalledOnce();
    expect(mock.lock).toHaveBeenLastCalledWith(false);
  });
  it('binds future schedule to KST and rejects empty or past time before confirmation', async () => {
    const user = userEvent.setup();
    render(subject());
    await ready();
    await user.click(screen.getByRole('button', { name: copy.scheduled }));
    const field = screen.getByLabelText(copy.scheduleLabel);
    await user.click(send());
    expect(screen.getByRole('alert')).toHaveTextContent(copy.invalidSchedule);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.change(field, { target: { value: '2026-10-24T20:00' } });
    await user.click(send());
    expect(mock.submit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(copy.invalidSchedule);
    fireEvent.change(field, { target: { value: '2026-10-25T10:30' } });
    await user.click(send());
    expect(screen.getByRole('dialog')).toHaveTextContent('2026년 10월 25일');
    expect(screen.getByRole('dialog')).toHaveTextContent('10:30:00');
    await user.click(screen.getByRole('button', { name: copy.confirmSubmit }));
    expect(mock.submit.mock.calls[0]![0].scheduledAt).toBe(
      '2026-10-25T01:30:00.000Z',
    );
  });
  it('never uses a changed draft captured after an open confirmation', async () => {
    const user = userEvent.setup();
    const view = render(subject());
    await ready();
    await user.click(send());
    view.rerender(subject({ draft: composeUiDraft({ revision: 2 }) }));
    await user.click(screen.getByRole('button', { name: copy.confirmSubmit }));
    expect(mock.submit).not.toHaveBeenCalled();
  });
  it('retains exact operation after unknown response and retry returns current canceled state', async () => {
    mock.submit.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    const user = userEvent.setup();
    render(subject());
    await ready();
    await confirmSend(user);
    const original = mock.submit.mock.calls[0]![0];
    expect(screen.getByText(copy.uncertain)).toBeVisible();
    expect(send()).toBeDisabled();
    mock.submit.mockResolvedValueOnce({
      ok: true,
      data: dispatchUiMessage({
        status: 'canceled',
        canceledAt: '2026-10-24T12:01:00Z',
        canCancel: false,
        notificationState: 'canceled',
      }),
    });
    await user.click(screen.getByRole('button', { name: copy.retrySame }));
    expect(mock.submit).toHaveBeenCalledTimes(2);
    expect(mock.submit.mock.calls[1]![0]).toEqual(original);
    expect(
      screen.getByRole('region', { name: copy.receipt }),
    ).toHaveTextContent(copy.statuses.canceled);
    expect(screen.queryByText(copy.uncertain)).not.toBeInTheDocument();
  });
  it('reconciles exact submitted message after lost response without another write', async () => {
    mock.submit.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    const user = userEvent.setup();
    render(subject());
    await ready();
    await confirmSend(user);
    mock.read.mockResolvedValueOnce({
      ok: true,
      data: dispatchUiPage({
        selectedMessage: dispatchUiMessage(),
        messages: [dispatchUiMessage()],
      }),
    });
    await user.click(screen.getByRole('button', { name: copy.checkStatus }));
    expect(mock.read.mock.calls.at(-1)![0]).toEqual({
      slug,
      messageId: ids.message,
    });
    expect(mock.submit).toHaveBeenCalledOnce();
    expect(mock.published).toHaveBeenCalledOnce();
    expect(screen.queryByText(copy.uncertain)).not.toBeInTheDocument();
  });
  it('does not resolve unknown writes from an empty first history page', async () => {
    mock.submit.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    const user = userEvent.setup();
    render(subject());
    await ready();
    await confirmSend(user);
    await user.click(screen.getByRole('button', { name: copy.checkStatus }));
    expect(screen.getByText(copy.uncertain)).toBeVisible();
    expect(send()).toBeDisabled();
    expect(mock.published).not.toHaveBeenCalled();
  });
  it('keeps a committed result frozen until stale composer refresh succeeds', async () => {
    mock.published.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const user = userEvent.setup();
    render(subject());
    await ready();
    await confirmSend(user);
    expect(screen.getByText(copy.refreshRequired)).toBeVisible();
    expect(send()).toBeDisabled();
    expect(mock.submit).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: copy.refreshEditor }));
    expect(screen.queryByText(copy.refreshRequired)).not.toBeInTheDocument();
    expect(mock.submit).toHaveBeenCalledOnce();
  });
  it('keeps composer frozen even when its post-commit refresh throws', async () => {
    mock.published.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    render(subject());
    await ready();
    await confirmSend(user);
    expect(screen.getByText(copy.refreshRequired)).toBeVisible();
    expect(send()).toBeDisabled();
  });
  it.each([
    'INVALID_INPUT',
    'NOT_FOUND',
    'CONFLICT',
    'MEDIA_PENDING',
    'CANCEL_WINDOW_PASSED',
    'RATE_LIMITED',
    'BACKPRESSURE',
    'SETUP_NOT_READY',
  ] as DispatchError[])(
    'shows %s mutation failure without optimistic success',
    async (code) => {
      mock.submit.mockResolvedValueOnce({ ok: false, code });
      const user = userEvent.setup();
      render(subject());
      await ready();
      await confirmSend(user);
      expect(screen.getByRole('alert')).toHaveTextContent(copy.errors[code]);
      expect(
        screen.queryByRole('region', { name: copy.receipt }),
      ).not.toBeInTheDocument();
      expect(mock.published).not.toHaveBeenCalled();
      expect(screen.queryByText(copy.uncertain)).not.toBeInTheDocument();
    },
  );
  it.each(['FORBIDDEN', 'UNAUTHENTICATED'] as DispatchError[])(
    'wipes message data on current %s access failure',
    async (code) => {
      mock.read.mockResolvedValueOnce({
        ok: true,
        data: dispatchUiPage({ messages: [dispatchUiMessage()] }),
      });
      const user = userEvent.setup();
      render(subject());
      await ready();
      expect(screen.getByText(dispatchUiMessage().body!)).toBeVisible();
      mock.read.mockResolvedValueOnce({ ok: false, code });
      await user.click(screen.getByRole('button', { name: copy.refresh }));
      expect(
        screen.queryByText(dispatchUiMessage().body!),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(copy.accessLost);
      expect(mock.lost).toHaveBeenCalledOnce();
    },
  );
  it('requires explicit cancel and preserves cancel-window failures', async () => {
    mock.read.mockResolvedValue({
      ok: true,
      data: dispatchUiPage({ messages: [dispatchUiMessage()] }),
    });
    const user = userEvent.setup();
    render(subject());
    await ready();
    await user.click(screen.getByRole('button', { name: copy.cancelMessage }));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      copy.cancelDescription,
    );
    await user.click(screen.getByRole('button', { name: copy.stay }));
    expect(mock.cancel).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: copy.cancelMessage }));
    mock.cancel.mockResolvedValueOnce({
      ok: false,
      code: 'CANCEL_WINDOW_PASSED',
    });
    await user.click(screen.getByRole('button', { name: copy.confirmCancel }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      copy.errors.CANCEL_WINDOW_PASSED,
    );
    expect(
      within(screen.getByRole('region', { name: copy.history })).getByText(
        copy.statuses.sent,
      ),
    ).toBeVisible();
  });
  it('uses exact cancellation retry and accepts only current canceled status reconciliation', async () => {
    mock.read.mockResolvedValue({
      ok: true,
      data: dispatchUiPage({ messages: [dispatchUiMessage()] }),
    });
    mock.cancel.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    const user = userEvent.setup();
    render(subject());
    await ready();
    await user.click(screen.getByRole('button', { name: copy.cancelMessage }));
    await user.click(screen.getByRole('button', { name: copy.confirmCancel }));
    mock.read.mockResolvedValueOnce({
      ok: true,
      data: dispatchUiPage({ selectedMessage: dispatchUiMessage() }),
    });
    await user.click(screen.getByRole('button', { name: copy.checkStatus }));
    expect(screen.getByText(copy.uncertain)).toBeVisible();
    const original = mock.cancel.mock.calls[0]![0];
    await user.click(screen.getByRole('button', { name: copy.retrySame }));
    expect(mock.cancel.mock.calls[1]![0]).toEqual(original);
    expect(
      screen.getByRole('region', { name: copy.receipt }),
    ).toHaveTextContent(copy.statuses.canceled);
    expect(mock.published).not.toHaveBeenCalled();
  });
  it('does not offer cancellation after server window or on canceled records', async () => {
    mock.read.mockResolvedValue({
      ok: true,
      data: dispatchUiPage({
        messages: [
          dispatchUiMessage({ canCancel: false }),
          dispatchUiMessage({
            id: ids.other,
            status: 'canceled',
            canceledAt: '2026-10-24T12:01:00Z',
            canCancel: false,
          }),
        ],
      }),
    });
    render(subject());
    await ready();
    expect(
      screen.queryByRole('button', { name: copy.cancelMessage }),
    ).not.toBeInTheDocument();
  });
  it('paginates with bound cursor and deduplicates only matching message identities', async () => {
    mock.read.mockResolvedValueOnce({
      ok: true,
      data: dispatchUiPage({
        messages: [dispatchUiMessage()],
        hasMore: true,
        nextCursor: 'next',
      }),
    });
    const user = userEvent.setup();
    render(subject());
    await ready();
    mock.read.mockResolvedValueOnce({
      ok: true,
      data: dispatchUiPage({
        messages: [dispatchUiMessage(), dispatchUiMessage({ id: ids.other })],
      }),
    });
    await user.click(screen.getByRole('button', { name: copy.older }));
    expect(mock.read.mock.calls[1]![0]).toEqual({
      slug,
      messageId: null,
      cursor: 'next',
    });
    expect(
      within(screen.getByRole('region', { name: copy.history })).getAllByRole(
        'listitem',
      ),
    ).toHaveLength(2);
    expect(
      screen.queryByRole('button', { name: copy.older }),
    ).not.toBeInTheDocument();
  });
  it('restores exact already-submitted ID independently of history first page', async () => {
    mock.read.mockResolvedValue({
      ok: true,
      data: dispatchUiPage({ selectedMessage: dispatchUiMessage() }),
    });
    render(subject({ draft: null, initialDispatchedId: ids.message }));
    await waitFor(() =>
      expect(screen.getByRole('region', { name: copy.receipt })).toBeVisible(),
    );
    expect(mock.read.mock.calls[0]![0]).toEqual({
      slug,
      messageId: ids.message,
    });
    expect(mock.submit).not.toHaveBeenCalled();
  });
  it('aborts an outgoing read and ignores its late private response', async () => {
    const waiting =
      deferred<DispatchResult<ReturnType<typeof dispatchUiPage>>>();
    mock.read.mockReturnValueOnce(waiting.promise);
    const view = render(subject());
    await waitFor(() => expect(mock.read).toHaveBeenCalledOnce());
    const signal = mock.read.mock.calls[0]![1] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () =>
      waiting.resolve({
        ok: true,
        data: dispatchUiPage({ messages: [dispatchUiMessage()] }),
      }),
    );
    expect(
      screen.queryByText(dispatchUiMessage().body!),
    ).not.toBeInTheDocument();
    expect(mock.published).not.toHaveBeenCalled();
  });
  it('dismisses confirmation on Back/Forward and never writes from the old screen', async () => {
    const user = userEvent.setup();
    render(subject());
    await ready();
    await user.click(send());
    act(() => {
      window.history.replaceState({}, '', routes.artist);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(mock.submit).not.toHaveBeenCalled();
    act(() => {
      window.history.replaceState({}, '', artistComposePath(slug));
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await ready();
    expect(mock.read).toHaveBeenCalledTimes(2);
  });
  it('never applies a late submit result after navigation or rewrites the newer URL', async () => {
    const waiting = deferred<DispatchResult<DispatchMessage>>();
    mock.submit.mockReturnValueOnce(waiting.promise);
    const user = userEvent.setup();
    render(subject());
    await ready();
    await confirmSend(user);
    const signal = mock.submit.mock.calls[0]![1] as AbortSignal;
    act(() => {
      window.history.replaceState({}, '', routes.artist);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(signal.aborted).toBe(true);
    await act(async () =>
      waiting.resolve({ ok: true, data: dispatchUiMessage() }),
    );
    expect(mock.published).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(routes.artist);
    expect(
      screen.queryByRole('region', { name: copy.receipt }),
    ).not.toBeInTheDocument();
  });
});
