import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DispatchHistoryScreen } from '@/components/artist-dispatch/DispatchHistoryScreen';
import { DialogProvider } from '@/components/ui/DialogProvider';
import { artistDispatchPath, routes } from '@/config/routes';
import messages from '@/messages/ko.json';
import { dispatchUiMessage, dispatchUiPage } from './dispatch-ui-fixtures';
const mock = vi.hoisted(() => ({
  read: vi.fn(),
  submit: vi.fn(),
  cancel: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('@/client/dispatch', () => ({
  readDispatchPage: mock.read,
  submitDispatch: mock.submit,
  cancelDispatch: mock.cancel,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mock.replace }),
}));
const copy = messages.artistDispatch;
const artist = dispatchUiPage().artist;
function subject() {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
      <DialogProvider>
        <DispatchHistoryScreen slug={artist.slug} name={artist.name} />
      </DialogProvider>
    </NextIntlClientProvider>
  );
}
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  window.history.replaceState({}, '', artistDispatchPath(artist.slug));
  mock.read.mockResolvedValue({
    ok: true,
    data: dispatchUiPage({
      messages: [
        dispatchUiMessage({
          status: 'scheduled',
          sentAt: null,
          canCancel: true,
          notificationState: 'not_queued',
          dispatchError: 'author_unavailable',
        }),
      ],
    }),
  });
  mock.cancel.mockResolvedValue({
    ok: true,
    data: dispatchUiMessage({
      status: 'canceled',
      canceledAt: '2026-10-24T12:01:00Z',
      canCancel: false,
      notificationState: 'canceled',
    }),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.fontScale;
});
describe('history-only dispatch screen', () => {
  it.each(['normal', 'large', 'xlarge'])(
    'exposes cancellation history without composing at %s scale',
    async (scale) => {
      document.documentElement.dataset.fontScale = scale;
      render(subject());
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: copy.cancelMessage }),
        ).toBeEnabled(),
      );
      expect(
        screen.getByRole('region', { name: copy.historyPanel }),
      ).toBeVisible();
      expect(screen.getByText(copy.historyNotice)).toBeVisible();
      expect(
        screen.queryByRole('button', { name: copy.submit }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: copy.scheduled }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(copy.savedOnly)).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(
        copy.dispatchErrors.author_unavailable,
      );
      expect(mock.submit).not.toHaveBeenCalled();
    },
  );
  it('cancels a paused-artist scheduled message through the separate fixed route', async () => {
    const user = userEvent.setup();
    render(subject());
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: copy.cancelMessage }),
      ).toBeEnabled(),
    );
    const back = screen.getByRole('button', {
      name: copy.backToHistoryArtists,
    });
    await user.click(screen.getByRole('button', { name: copy.cancelMessage }));
    expect(back).toBeDisabled();
    await user.click(screen.getByRole('button', { name: copy.confirmCancel }));
    expect(
      screen.getByRole('region', { name: copy.receipt }),
    ).toHaveTextContent(copy.statuses.canceled);
    expect(mock.cancel).toHaveBeenCalledOnce();
    expect(mock.submit).not.toHaveBeenCalled();
    expect(back).toBeEnabled();
    await user.click(back);
    expect(mock.replace).toHaveBeenCalledWith(routes.artistDispatchHistory);
  });
  it('retains same cancellation after unknown response and clears content on permission loss', async () => {
    mock.cancel.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    const user = userEvent.setup();
    render(subject());
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: copy.cancelMessage }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: copy.cancelMessage }));
    await user.click(screen.getByRole('button', { name: copy.confirmCancel }));
    expect(screen.getByText(copy.uncertain)).toBeVisible();
    expect(
      screen.getByRole('button', { name: copy.backToHistoryArtists }),
    ).toBeDisabled();
    mock.read.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
    await user.click(screen.getByRole('button', { name: copy.checkStatus }));
    expect(
      screen.queryByText(dispatchUiMessage().body!),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(copy.accessLost);
    expect(
      screen.getByRole('button', { name: copy.backToHistoryArtists }),
    ).toBeEnabled();
  });
  it('does not make history requests after navigation outside its exact route', async () => {
    render(subject());
    await waitFor(() => expect(mock.read).toHaveBeenCalledOnce());
    act(() => {
      window.history.replaceState({}, '', routes.artistDispatchHistory);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(mock.read).toHaveBeenCalledOnce();
    expect(
      screen.queryByText(dispatchUiMessage().body!),
    ).not.toBeInTheDocument();
    act(() => {
      window.history.replaceState({}, '', artistDispatchPath(artist.slug));
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(2));
  });
});
