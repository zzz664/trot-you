import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtistComposer } from '@/components/artist-compose/ArtistComposer';
import { DialogProvider } from '@/components/ui/DialogProvider';
import { artistComposePath, routes } from '@/config/routes';
import type { ComposePageData, ComposeResult } from '@/config/artist-compose';
import messages from '@/messages/ko.json';
import { composeUiDraft, composeUiPage, deferred } from './compose-ui-fixtures';
import {
  dispatchUiIds as ids,
  dispatchUiMessage,
  dispatchUiPage,
} from './dispatch-ui-fixtures';
const mock = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  preview: vi.fn(),
  remove: vi.fn(),
  dispatchRead: vi.fn(),
  submit: vi.fn(),
  cancel: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('@/client/compose', () => ({
  readComposePage: mock.read,
  saveComposeDraft: mock.save,
  previewComposeDraft: mock.preview,
  removeComposeMedia: mock.remove,
}));
vi.mock('@/client/dispatch', () => ({
  readDispatchPage: mock.dispatchRead,
  submitDispatch: mock.submit,
  cancelDispatch: mock.cancel,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mock.replace }),
}));
vi.mock('@/components/media/SecureMedia', () => ({ SecureMedia: () => null }));
const slug = composeUiPage().artist.slug;
const compose = messages.artistCompose;
const copy = messages.artistDispatch;
function subject(initial = composeUiPage(), initialDispatchedId?: string) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
      <DialogProvider>
        <ArtistComposer
          initial={initial}
          {...(initialDispatchedId ? { initialDispatchedId } : {})}
        />
      </DialogProvider>
    </NextIntlClientProvider>
  );
}
const body = () => screen.getByRole('textbox', { name: compose.body });
const send = () => screen.getByRole('button', { name: copy.submit });
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  window.history.replaceState({}, '', artistComposePath(slug));
  mock.read.mockResolvedValue({ ok: true, data: composeUiPage() });
  mock.dispatchRead.mockImplementation(
    async ({ messageId }: { messageId: string | null }) => ({
      ok: true,
      data: dispatchUiPage({
        selectedMessage: messageId
          ? dispatchUiMessage({ id: messageId })
          : null,
      }),
    }),
  );
  mock.submit.mockResolvedValue({ ok: true, data: dispatchUiMessage() });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('dispatch composer integration', () => {
  it('recovers server fallback props at the actual old draft URL instead of hiding history', async () => {
    window.history.replaceState({}, '', artistComposePath(slug, ids.message));
    mock.read
      .mockResolvedValueOnce({ ok: false, code: 'CONFLICT' })
      .mockResolvedValueOnce({ ok: true, data: composeUiPage() });
    render(subject(composeUiPage(), ids.message));
    await waitFor(() => expect(body()).toHaveValue(''));
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: copy.receipt }),
      ).toHaveTextContent(copy.statuses.sent),
    );
    expect(window.location.pathname + window.location.search).toBe(
      artistComposePath(slug),
    );
    expect(mock.dispatchRead).toHaveBeenCalledWith(
      { slug, messageId: ids.message },
      expect.any(AbortSignal),
    );
    expect(mock.submit).not.toHaveBeenCalled();
    expect(screen.queryByText(compose.errors.CONFLICT)).not.toBeInTheDocument();
  });
  it('recovers cached Back/Forward to a submitted draft by exact owned receipt', async () => {
    render(subject());
    await waitFor(() => expect(screen.getByText(copy.empty)).toBeVisible());
    mock.read
      .mockResolvedValueOnce({ ok: false, code: 'CONFLICT' })
      .mockResolvedValueOnce({ ok: true, data: composeUiPage() });
    act(() => {
      window.history.replaceState({}, '', artistComposePath(slug, ids.message));
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: copy.receipt }),
      ).toHaveTextContent(copy.statuses.sent),
    );
    expect(body()).toHaveValue('');
    expect(window.location.search).toBe('');
    expect(mock.submit).not.toHaveBeenCalled();
  });
  it('does not replace an unavailable or unowned draft with inferred first-page success', async () => {
    window.history.replaceState({}, '', artistComposePath(slug, ids.message));
    mock.read.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
    mock.dispatchRead.mockResolvedValue({
      ok: true,
      data: dispatchUiPage({
        messages: [dispatchUiMessage()],
        selectedMessage: null,
      }),
    });
    render(subject());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(compose.accessLost),
    );
    expect(window.location.search).toContain(ids.message);
    expect(
      screen.queryByRole('region', { name: copy.receipt }),
    ).not.toBeInTheDocument();
    expect(mock.read).toHaveBeenCalledOnce();
  });
  it('wipes a retained editable draft when both current reads verify NOT_FOUND', async () => {
    const initial = composeUiPage({
      selectedDraft: composeUiDraft(),
      drafts: [composeUiDraft()],
    });
    window.history.replaceState({}, '', artistComposePath(slug, ids.message));
    const user = userEvent.setup();
    render(subject(initial));
    await waitFor(() => expect(send()).toBeEnabled());
    mock.read.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    mock.dispatchRead.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    await user.click(screen.getByRole('button', { name: compose.refresh }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(compose.accessLost),
    );
    expect(
      screen.queryByRole('textbox', { name: compose.body }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(composeUiDraft().body!)).not.toBeInTheDocument();
  });
  it('clears private content when current access is lost during old-URL recovery', async () => {
    window.history.replaceState({}, '', artistComposePath(slug, ids.message));
    mock.read.mockResolvedValue({ ok: false, code: 'CONFLICT' });
    mock.dispatchRead.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    render(subject());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(compose.accessLost),
    );
    expect(
      screen.queryByRole('textbox', { name: compose.body }),
    ).not.toBeInTheDocument();
  });
  it('does not apply a clean-composer recovery that returns after newer navigation', async () => {
    window.history.replaceState({}, '', artistComposePath(slug, ids.message));
    const waiting = deferred<ComposeResult<ComposePageData>>();
    mock.read
      .mockResolvedValueOnce({ ok: false, code: 'CONFLICT' })
      .mockReturnValueOnce(waiting.promise);
    render(subject());
    await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(2));
    act(() => {
      window.history.replaceState({}, '', routes.artist);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await act(async () => waiting.resolve({ ok: true, data: composeUiPage() }));
    expect(window.location.pathname).toBe(routes.artist);
    expect(
      screen.queryByRole('textbox', { name: compose.body }),
    ).not.toBeInTheDocument();
  });
  it('freezes editor through explicit confirmation and uncertain response then clears only on receipt', async () => {
    const initial = composeUiPage({
      selectedDraft: composeUiDraft(),
      drafts: [composeUiDraft()],
    });
    window.history.replaceState({}, '', artistComposePath(slug, ids.message));
    mock.dispatchRead.mockResolvedValue({ ok: true, data: dispatchUiPage() });
    mock.submit
      .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
      .mockResolvedValueOnce({ ok: true, data: dispatchUiMessage() });
    const user = userEvent.setup();
    render(subject(initial));
    await waitFor(() => expect(send()).toBeEnabled());
    const editor = body();
    await user.click(send());
    expect(editor).toBeDisabled();
    await user.click(screen.getByRole('button', { name: copy.confirmSubmit }));
    expect(body()).toBeDisabled();
    expect(screen.getByRole('button', { name: compose.save })).toBeDisabled();
    expect(screen.getByRole('button', { name: compose.back })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: copy.retrySame }));
    await waitFor(() => expect(body()).toBeEnabled());
    expect(body()).toHaveValue('');
    expect(send()).toBeDisabled();
    expect(window.location.search).toBe('');
    expect(mock.submit.mock.calls[1]![0]).toEqual(
      mock.submit.mock.calls[0]![0],
    );
  });
  it('requires a saved clean revision after editing and does not dispatch on save', async () => {
    const initial = composeUiPage({
      selectedDraft: composeUiDraft(),
      drafts: [composeUiDraft()],
    });
    window.history.replaceState({}, '', artistComposePath(slug, ids.message));
    const user = userEvent.setup();
    render(subject(initial));
    await waitFor(() => expect(send()).toBeEnabled());
    fireEvent.change(body(), { target: { value: '바뀐 내용' } });
    expect(send()).toBeDisabled();
    mock.save.mockResolvedValueOnce({
      ok: true,
      data: composeUiDraft({ body: '바뀐 내용', revision: 2 }),
    });
    await user.click(screen.getByRole('button', { name: compose.save }));
    expect(send()).toBeEnabled();
    expect(mock.submit).not.toHaveBeenCalled();
    await user.click(send());
    await user.click(screen.getByRole('button', { name: copy.confirmSubmit }));
    expect(mock.submit.mock.calls[0]![0].expectedRevision).toBe(2);
  });
});
