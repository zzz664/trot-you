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
import type {
  ComposeDraft,
  ComposePageData,
  ComposeResult,
  ComposeSaveInput,
} from '@/config/artist-compose';
import messages from '@/messages/ko.json';
import { artistComposePath, routes } from '@/config/routes';
import {
  composeUiDraft,
  composeUiIds as ids,
  composeUiPage,
  deferred,
} from './compose-ui-fixtures';
const mock = vi.hoisted(() => ({
  read: vi.fn(),
  dispatch: vi.fn(),
  save: vi.fn(),
  preview: vi.fn(),
  remove: vi.fn(),
  replace: vi.fn(),
  begin: vi.fn(),
  bytes: vi.fn(),
  complete: vi.fn(),
  revoke: vi.fn(),
  resize: vi.fn(),
}));
vi.mock('@/client/dispatch', () => ({ readDispatchPage: mock.dispatch }));
vi.mock('@/components/artist-dispatch/ArtistDispatch', () => ({
  ArtistDispatch: () => null,
}));
vi.mock('@/client/compose', () => ({
  readComposePage: mock.read,
  saveComposeDraft: mock.save,
  previewComposeDraft: mock.preview,
  removeComposeMedia: mock.remove,
}));
vi.mock('@/client/media', () => ({
  beginMediaUpload: mock.begin,
  uploadMediaBytes: mock.bytes,
  completeMediaUpload: mock.complete,
  revokeMediaUpload: mock.revoke,
}));
vi.mock('@/client/compose-photo', () => ({
  resizeComposePhoto: mock.resize,
  ComposePhotoError: class extends Error {
    code = 'invalid';
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mock.replace }),
}));
vi.mock('@/components/media/SecureMedia', () => ({
  SecureMedia: ({ mediaId }: { mediaId: string }) => (
    <p data-testid="secure-media">{mediaId}</p>
  ),
}));
const copy = messages.artistCompose;
function subject(initial = composeUiPage()) {
  if (
    initial.selectedDraft &&
    !new URL(window.location.href).searchParams.has('draft')
  )
    window.history.replaceState(
      {},
      '',
      artistComposePath(initial.artist.slug, initial.selectedDraft.id),
    );
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
      <DialogProvider>
        <ArtistComposer initial={initial} />
      </DialogProvider>
    </NextIntlClientProvider>
  );
}
function saved(input: ComposeSaveInput): ComposeResult<ComposeDraft> {
  return {
    ok: true,
    data: composeUiDraft({
      id: input.messageId,
      kind: input.kind,
      body: input.body,
      revision: input.expectedRevision + 1,
    }),
  };
}
const body = () => screen.getByRole('textbox', { name: copy.body });
const save = () => screen.getByRole('button', { name: copy.save });
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  window.history.replaceState(
    {},
    '',
    artistComposePath(composeUiPage().artist.slug),
  );
  mock.save.mockImplementation(async (input: ComposeSaveInput) => saved(input));
  mock.read.mockResolvedValue({ ok: true, data: composeUiPage() });
  mock.dispatch.mockResolvedValue({
    ok: true,
    data: { selectedMessage: null },
  });
  mock.preview.mockResolvedValue({
    ok: true,
    data: { sampleName: '순자', text: '서버가 만든 미리 보기' },
  });
  mock.resize.mockImplementation(
    async (file: File) => new File([file], 'photo.jpg', { type: 'image/jpeg' }),
  );
  mock.begin.mockResolvedValue({
    ok: true,
    data: {
      uploadId: ids.upload,
      uploadUrl: 'https://invalid.example/private',
      expiresAt: '2099-01-01T00:00:00Z',
    },
  });
  mock.bytes.mockResolvedValue({ ok: true, data: null });
  mock.complete.mockResolvedValue({ ok: true, data: { mediaId: ids.media } });
  mock.revoke.mockResolvedValue({ ok: true, data: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.fontScale;
});
describe('artist draft composer', () => {
  it.each(['normal', 'large', 'xlarge'])(
    'keeps explicit draft-only controls at %s scale',
    async (scale) => {
      document.documentElement.dataset.fontScale = scale;
      render(subject());
      expect(screen.getByText(copy.draftOnly)).toBeVisible();
      expect(body()).toBeVisible();
      expect(save()).toBeEnabled();
      expect(
        screen.queryByRole('button', { name: /^전송|예약 발송/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: copy.back })).toBeVisible();
    },
  );
  it('rejects blank text and oversized Unicode scalar content before requesting a save', async () => {
    const user = userEvent.setup();
    render(
      subject(
        composeUiPage({
          policy: { ...composeUiPage().policy, maxTextLength: 2 },
        }),
      ),
    );
    await user.click(save());
    expect(mock.save).not.toHaveBeenCalled();
    fireEvent.change(body(), { target: { value: '😀😀😀' } });
    await user.click(save());
    expect(mock.save).not.toHaveBeenCalled();
    expect(screen.getByText(copy.errors.TOO_LONG)).toBeVisible();
  });
  it('stores a preallocated resource once despite rapid repeated clicks and retains its deep link', async () => {
    const pending = deferred<ComposeResult<ComposeDraft>>();
    mock.save.mockReturnValue(pending.promise);
    render(subject());
    fireEvent.change(body(), { target: { value: '첫 초안' } });
    fireEvent.click(save());
    fireEvent.click(screen.getByRole('button', { name: copy.saving }));
    expect(mock.save).toHaveBeenCalledTimes(1);
    const input = mock.save.mock.calls[0]![0] as ComposeSaveInput;
    expect(new URL(window.location.href).searchParams.get('draft')).toBe(
      input.messageId,
    );
    await act(async () => pending.resolve(saved(input)));
    expect(body()).toHaveValue('첫 초안');
    expect(screen.getByText(copy.saved)).toBeVisible();
  });
  it('retains exact operation and frozen content after a lost save response', async () => {
    mock.save
      .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
      .mockImplementation(async (input: ComposeSaveInput) => saved(input));
    mock.read.mockImplementation(
      async ({ messageId }: { messageId: string }) => ({
        ok: true,
        data: composeUiPage({
          selectedDraft: composeUiDraft({
            id: messageId,
            body: '응답이 없어도 한 번',
          }),
        }),
      }),
    );
    const user = userEvent.setup();
    render(subject());
    fireEvent.change(body(), { target: { value: '응답이 없어도 한 번' } });
    await user.click(save());
    expect(body()).toHaveAttribute('readonly');
    fireEvent.change(body(), { target: { value: '다른 내용' } });
    expect(body()).toHaveValue('응답이 없어도 한 번');
    await user.click(screen.getByRole('button', { name: copy.retrySave }));
    expect(mock.save).toHaveBeenCalledTimes(2);
    expect(mock.save.mock.calls[0]![0]).toEqual(mock.save.mock.calls[1]![0]);
    expect(screen.getByText(copy.saved)).toBeVisible();
  });
  it('keeps CAS conflict visible and reloads authoritative draft only after confirmation', async () => {
    const initial = composeUiDraft();
    const newer = composeUiDraft({ body: '다른 화면의 내용', revision: 2 });
    mock.save.mockResolvedValue({ ok: false, code: 'CONFLICT' });
    mock.read.mockResolvedValue({
      ok: true,
      data: composeUiPage({ drafts: [newer], selectedDraft: newer }),
    });
    const user = userEvent.setup();
    render(
      subject(composeUiPage({ drafts: [initial], selectedDraft: initial })),
    );
    fireEvent.change(body(), { target: { value: '오래된 화면 수정' } });
    await user.click(save());
    await user.click(screen.getByRole('button', { name: copy.reload }));
    expect(screen.getByRole('dialog')).toBeVisible();
    await user.click(screen.getByRole('button', { name: copy.discard }));
    await waitFor(() => expect(body()).toHaveValue(newer.body));
  });
  it('inserts the literal name token at the current caret without browser personalization', async () => {
    const user = userEvent.setup();
    render(subject());
    fireEvent.change(body(), { target: { value: '앞 뒤' } });
    const field = body() as HTMLTextAreaElement;
    field.focus();
    field.setSelectionRange(2, 2);
    await user.click(screen.getByRole('button', { name: copy.insertName }));
    expect(body()).toHaveValue('앞 {이름}뒤');
    expect(mock.preview).not.toHaveBeenCalled();
  });
  it('validates sample name and renders only server-personalized preview as text', async () => {
    const user = userEvent.setup();
    render(subject());
    fireEvent.change(body(), { target: { value: '{이름} <script>' } });
    await user.click(screen.getByRole('button', { name: copy.preview }));
    expect(mock.preview).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: copy.sampleName }), {
      target: { value: '순자' },
    });
    await user.click(screen.getByRole('button', { name: copy.preview }));
    expect(screen.getByText('서버가 만든 미리 보기')).toBeVisible();
    expect(mock.preview.mock.calls[0]![0]).toMatchObject({
      body: '{이름} <script>',
      sampleName: '순자',
      messageId: null,
    });
  });
  it('requires explicit save before showing media picker for a new photo draft', async () => {
    const user = userEvent.setup();
    render(subject());
    await user.click(screen.getByRole('button', { name: copy.kinds.photo }));
    expect(screen.getByText(copy.saveBeforeUpload)).toBeVisible();
    expect(
      screen.queryByLabelText(copy.fileLabel.photo),
    ).not.toBeInTheDocument();
    await user.click(save());
    expect(screen.getByLabelText(copy.fileLabel.photo)).toBeVisible();
    expect(mock.begin).not.toHaveBeenCalled();
  });
  it('rejects role/membership loss and removes private editor and media', async () => {
    const draft = composeUiDraft({
      kind: 'photo',
      media: [
        { id: ids.media, kind: 'photo', width: 1, height: 1, durationMs: null },
      ],
    });
    mock.save.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    const user = userEvent.setup();
    render(subject(composeUiPage({ drafts: [draft], selectedDraft: draft })));
    fireEvent.change(body(), { target: { value: '비공개 초안' } });
    await user.click(save());
    expect(screen.getByText(copy.accessLost)).toBeVisible();
    expect(
      screen.queryByRole('textbox', { name: copy.body }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('secure-media')).not.toBeInTheDocument();
  });
  it('ignores a late save after navigating to another resource', async () => {
    const request = deferred<ComposeResult<ComposeDraft>>();
    mock.save.mockReturnValue(request.promise);
    const newer = composeUiDraft({ id: ids.other, body: '다른 초안' });
    mock.read.mockResolvedValue({
      ok: true,
      data: composeUiPage({ selectedDraft: newer, drafts: [newer] }),
    });
    render(subject());
    fireEvent.change(body(), { target: { value: '늦은 초안' } });
    fireEvent.click(save());
    const input = mock.save.mock.calls[0]![0] as ComposeSaveInput;
    window.history.replaceState(
      {},
      '',
      artistComposePath(composeUiPage().artist.slug, ids.other),
    );
    await act(async () => window.dispatchEvent(new PopStateEvent('popstate')));
    await waitFor(() => expect(body()).toHaveValue('다른 초안'));
    await act(async () => request.resolve(saved(input)));
    expect(body()).toHaveValue('다른 초안');
  });
  it('cancels unsaved navigation without clearing the editor, then permits explicit discard', async () => {
    const user = userEvent.setup();
    render(subject());
    fireEvent.change(body(), { target: { value: '남길 내용' } });
    await user.click(screen.getByRole('button', { name: copy.back }));
    await user.click(screen.getByRole('button', { name: copy.stay }));
    expect(body()).toHaveValue('남길 내용');
    expect(mock.replace).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: copy.back }));
    await user.click(screen.getByRole('button', { name: copy.discard }));
    expect(mock.replace).toHaveBeenCalledWith('/artist');
  });
  it('removes an attachment using its own revision and stable operation', async () => {
    const draft = composeUiDraft({
      kind: 'photo',
      media: [
        { id: ids.media, kind: 'photo', width: 1, height: 1, durationMs: null },
      ],
    });
    mock.remove.mockResolvedValue({
      ok: true,
      data: { ...draft, revision: 2, media: [] },
    });
    const user = userEvent.setup();
    render(subject(composeUiPage({ drafts: [draft], selectedDraft: draft })));
    await user.click(screen.getByRole('button', { name: '첨부 1 삭제' }));
    expect(mock.remove.mock.calls[0]![0]).toMatchObject({
      messageId: ids.message,
      mediaId: ids.media,
      expectedRevision: 1,
    });
    expect(screen.queryByTestId('secure-media')).not.toBeInTheDocument();
  });
  it('loads older server drafts without replacing current unsaved content', async () => {
    const older = composeUiDraft({ id: ids.other });
    mock.read.mockResolvedValue({
      ok: true,
      data: composeUiPage({
        drafts: [older],
        hasMore: false,
        nextCursor: null,
      }),
    });
    const user = userEvent.setup();
    render(subject(composeUiPage({ hasMore: true, nextCursor: 'opaque' })));
    fireEvent.change(body(), { target: { value: '진행 중인 글' } });
    await user.click(screen.getByRole('button', { name: copy.older }));
    expect(body()).toHaveValue('진행 중인 글');
    expect(mock.read.mock.calls[0]![0]).toMatchObject({ cursor: 'opaque' });
    expect(
      document.querySelector(`[data-message-id="${ids.other}"]`),
    ).toBeInTheDocument();
  });
});

describe('artist upload recovery', () => {
  function photoPage(overrides: Partial<ComposeDraft> = {}) {
    const draft = composeUiDraft({ kind: 'photo', body: null, ...overrides });
    return composeUiPage({ drafts: [draft], selectedDraft: draft });
  }
  const file = () =>
    new File(['fictional bytes'], 'private-location.jpg', {
      type: 'image/jpeg',
    });
  async function ready(initial = photoPage()) {
    const user = userEvent.setup();
    render(subject(initial));
    await user.upload(screen.getByLabelText(copy.fileLabel.photo), file());
    await screen.findByText(copy.fileReady);
    return user;
  }
  it('resizes only selected photo and waits for explicit upload; no filename leaves the UI', async () => {
    const user = await ready();
    expect(mock.resize).toHaveBeenCalledTimes(1);
    expect(mock.begin).not.toHaveBeenCalled();
    expect(screen.queryByText('private-location.jpg')).not.toBeInTheDocument();
    expect(body()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: copy.upload }));
    await waitFor(() => expect(mock.complete).toHaveBeenCalledTimes(1));
    expect(mock.begin.mock.calls[0]![0]).toEqual({
      requestId: expect.any(String),
      messageId: ids.message,
      mimeType: 'image/jpeg',
      byteSize: file().size,
    });
    expect(mock.bytes.mock.calls[0]![1].name).toBe('photo.jpg');
  });
  it('cancels a prepared file without creating a server upload', async () => {
    const user = await ready();
    await user.click(screen.getByRole('button', { name: copy.cancelUpload }));
    expect(mock.begin).not.toHaveBeenCalled();
    expect(mock.revoke).not.toHaveBeenCalled();
    expect(body()).toBeEnabled();
  });
  it('recovers lost begin with the exact request key rather than another intent', async () => {
    const grant = {
      ok: true,
      data: {
        uploadId: ids.upload,
        uploadUrl: 'https://invalid.example/private',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    };
    mock.begin
      .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
      .mockResolvedValueOnce(grant);
    const user = await ready();
    await user.click(screen.getByRole('button', { name: copy.upload }));
    await user.click(screen.getByRole('button', { name: copy.uploadRetry }));
    expect(mock.begin).toHaveBeenCalledTimes(2);
    expect(mock.begin.mock.calls[0]![0]).toEqual(mock.begin.mock.calls[1]![0]);
    expect(mock.bytes).toHaveBeenCalledTimes(1);
  });
  it('checks same completion after an uncertain PUT without overwriting uploaded bytes', async () => {
    mock.bytes.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    const user = await ready();
    await user.click(screen.getByRole('button', { name: copy.upload }));
    expect(mock.complete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: copy.uploadRetry }));
    expect(mock.bytes).toHaveBeenCalledTimes(1);
    expect(mock.begin).toHaveBeenCalledTimes(1);
    expect(mock.complete.mock.calls[0]![0]).toEqual({ uploadId: ids.upload });
  });
  it('replays the same completion after lost success without another PUT', async () => {
    mock.complete
      .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
      .mockResolvedValueOnce({ ok: true, data: { mediaId: ids.media } });
    const user = await ready();
    await user.click(screen.getByRole('button', { name: copy.upload }));
    await user.click(screen.getByRole('button', { name: copy.uploadRetry }));
    expect(mock.complete).toHaveBeenCalledTimes(2);
    expect(mock.complete.mock.calls[0]![0]).toEqual(
      mock.complete.mock.calls[1]![0],
    );
    expect(mock.bytes).toHaveBeenCalledTimes(1);
  });
  it('revokes the recovered intent when cancel races a lost begin response', async () => {
    const pending = deferred<unknown>();
    const grant = {
      ok: true,
      data: {
        uploadId: ids.upload,
        uploadUrl: 'https://invalid.example/private',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    };
    mock.begin
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(grant);
    const user = await ready();
    await user.click(screen.getByRole('button', { name: copy.upload }));
    await user.click(screen.getByRole('button', { name: copy.cancelUpload }));
    expect(mock.revoke.mock.calls[0]![0]).toEqual({ uploadId: ids.upload });
    await act(async () => pending.resolve(grant));
    expect(mock.bytes).not.toHaveBeenCalled();
    expect(mock.complete).not.toHaveBeenCalled();
  });
  it('surfaces current completed media when cancel loses to finalization', async () => {
    mock.revoke.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    const pending = deferred<unknown>();
    mock.complete.mockReturnValue(pending.promise);
    const current = photoPage({
      revision: 2,
      media: [
        { id: ids.media, kind: 'photo', width: 2, height: 2, durationMs: null },
      ],
    });
    mock.read.mockResolvedValue({ ok: true, data: current });
    const user = await ready();
    await user.click(screen.getByRole('button', { name: copy.upload }));
    await user.click(screen.getByRole('button', { name: copy.cancelUpload }));
    expect(await screen.findByTestId('secure-media')).toHaveTextContent(
      ids.media,
    );
    await act(async () =>
      pending.resolve({ ok: true, data: { mediaId: ids.media } }),
    );
    expect(mock.revoke).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('secure-media')).toHaveTextContent(ids.media);
  });
  it('allows refresh recovery to revoke bounded pending logical IDs only', async () => {
    const current = photoPage();
    mock.read.mockResolvedValue({ ok: true, data: current });
    const user = userEvent.setup();
    render(subject(photoPage({ pendingUploadIds: [ids.upload] })));
    expect(screen.getByLabelText(copy.fileLabel.photo)).toBeDisabled();
    await user.click(screen.getByRole('button', { name: copy.clearPending }));
    expect(mock.revoke.mock.calls[0]![0]).toEqual({ uploadId: ids.upload });
    await waitFor(() =>
      expect(screen.getByLabelText(copy.fileLabel.photo)).toBeEnabled(),
    );
  });
  it('holds upload state on unknown revoke and permits same cancel retry', async () => {
    mock.revoke
      .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
      .mockResolvedValueOnce({ ok: true, data: null });
    mock.bytes.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    const user = await ready();
    await user.click(screen.getByRole('button', { name: copy.upload }));
    await user.click(screen.getByRole('button', { name: copy.cancelUpload }));
    expect(body()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: copy.cancelUpload }));
    expect(mock.revoke).toHaveBeenCalledTimes(2);
    expect(mock.revoke.mock.calls[0]![0]).toEqual(
      mock.revoke.mock.calls[1]![0],
    );
  });
  it('forbidden completion closes private draft and rejects late retries', async () => {
    mock.complete.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    const user = await ready();
    await user.click(screen.getByRole('button', { name: copy.upload }));
    expect(screen.getByText(copy.accessLost)).toBeVisible();
    expect(
      screen.queryByLabelText(copy.fileLabel.photo),
    ).not.toBeInTheDocument();
  });
  it('refuses over-limit video before any intent or browser decoder', async () => {
    const draft = composeUiDraft({ kind: 'video', body: null });
    const initial = composeUiPage({
      selectedDraft: draft,
      policy: { ...composeUiPage().policy, videoMaxBytes: 2 },
    });
    const user = userEvent.setup();
    render(subject(initial));
    await user.upload(
      screen.getByLabelText(copy.fileLabel.video),
      new File(['too large'], 'secret.mp4', { type: 'video/mp4' }),
    );
    expect(screen.getByText(copy.errors.tooLarge)).toBeVisible();
    expect(mock.begin).not.toHaveBeenCalled();
    expect(mock.resize).not.toHaveBeenCalled();
  });
});

describe('artist replay projection safety', () => {
  it('displays a newer authoritative revision after replay rather than its historical receipt', async () => {
    const initial = composeUiDraft();
    mock.save
      .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
      .mockImplementation(async (input: ComposeSaveInput) => saved(input));
    const newest = composeUiDraft({
      revision: 3,
      body: '다른 화면의 최신 초안',
    });
    mock.read.mockResolvedValue({
      ok: true,
      data: composeUiPage({ selectedDraft: newest, drafts: [newest] }),
    });
    const user = userEvent.setup();
    render(subject(composeUiPage({ selectedDraft: initial })));
    fireEvent.change(body(), { target: { value: '이 화면이 저장한 내용' } });
    await user.click(save());
    await user.click(screen.getByRole('button', { name: copy.retrySave }));
    expect(body()).toHaveValue(newest.body);
    expect(body()).not.toHaveAttribute('readonly');
  });
  it('keeps the editor frozen if replay succeeds but current-state revalidation fails', async () => {
    mock.save
      .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
      .mockImplementation(async (input: ComposeSaveInput) => saved(input));
    mock.read.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    const user = userEvent.setup();
    render(subject());
    fireEvent.change(body(), { target: { value: '재검증 대기' } });
    await user.click(save());
    await user.click(screen.getByRole('button', { name: copy.retrySave }));
    expect(body()).toHaveAttribute('readonly');
    expect(screen.getByText(copy.uncertain)).toBeVisible();
  });
  it('clears an uncreated deep link after a definitive first-create validation rejection', async () => {
    mock.save.mockResolvedValue({ ok: false, code: 'INVALID_INPUT' });
    const user = userEvent.setup();
    render(subject());
    fireEvent.change(body(), { target: { value: '서버가 거절한 내용' } });
    await user.click(save());
    expect(new URL(window.location.href).searchParams.has('draft')).toBe(false);
    expect(body()).toHaveValue('서버가 거절한 내용');
  });
});

describe('authoritative upload aftermath', () => {
  function page() {
    const draft = composeUiDraft({ kind: 'photo', body: null });
    return composeUiPage({ selectedDraft: draft, drafts: [draft] });
  }
  async function prepared() {
    const user = userEvent.setup();
    render(subject(page()));
    await user.upload(
      screen.getByLabelText(copy.fileLabel.photo),
      new File(['x'], 'source.jpg', { type: 'image/jpeg' }),
    );
    await screen.findByText(copy.fileReady);
    return user;
  }
  it('freezes the editor after successful completion if fresh draft lookup is unavailable', async () => {
    mock.read
      .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
      .mockResolvedValueOnce({ ok: true, data: page() });
    const user = await prepared();
    await user.click(screen.getByRole('button', { name: copy.upload }));
    expect(body()).toHaveAttribute('readonly');
    expect(screen.getAllByRole('button', { name: copy.reload })).toHaveLength(
      1,
    );
    await user.click(screen.getByRole('button', { name: copy.reload }));
    expect(body()).not.toHaveAttribute('readonly');
    expect(mock.complete).toHaveBeenCalledOnce();
    expect(mock.save).not.toHaveBeenCalled();
  });
  it('reconciles definitive no-grant rejection on cancel instead of trapping all draft controls', async () => {
    mock.begin.mockResolvedValue({ ok: false, code: 'LIMIT_EXCEEDED' });
    mock.read.mockResolvedValue({ ok: true, data: page() });
    const user = await prepared();
    await user.click(screen.getByRole('button', { name: copy.upload }));
    expect(
      screen.queryByRole('button', { name: copy.uploadRetry }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: copy.cancelUpload }));
    expect(body()).toBeEnabled();
    expect(mock.revoke).not.toHaveBeenCalled();
    expect(mock.read).toHaveBeenCalledOnce();
  });
  it('keeps a known invalid completion available for explicit cancellation but not a futile retry', async () => {
    mock.complete.mockResolvedValue({ ok: false, code: 'INVALID_CONTENT' });
    mock.read.mockResolvedValue({ ok: true, data: page() });
    const user = await prepared();
    await user.click(screen.getByRole('button', { name: copy.upload }));
    expect(
      screen.queryByRole('button', { name: copy.uploadRetry }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: copy.cancelUpload }));
    expect(mock.revoke).toHaveBeenCalledOnce();
    expect(body()).toBeEnabled();
  });
});

describe('real revoke refusal reconciliation', () => {
  const initial = () => {
    const draft = composeUiDraft({ kind: 'photo', body: null });
    return composeUiPage({ selectedDraft: draft, drafts: [draft] });
  };
  async function uncertainUpload() {
    mock.complete.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    mock.revoke.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    const user = userEvent.setup();
    render(subject(initial()));
    await user.upload(
      screen.getByLabelText(copy.fileLabel.photo),
      new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
    );
    await user.click(await screen.findByRole('button', { name: copy.upload }));
    await screen.findByRole('button', { name: copy.uploadRetry });
    return user;
  }
  it('closes retained content when current ownership really is revoked after a completed-intent refusal', async () => {
    mock.read.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    const user = await uncertainUpload();
    await user.click(screen.getByRole('button', { name: copy.cancelUpload }));
    expect(mock.read).toHaveBeenCalledOnce();
    expect(screen.getByText(copy.accessLost)).toBeVisible();
    expect(screen.queryByText(copy.canceledUpload)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: copy.body }),
    ).not.toBeInTheDocument();
  });
  it('does not claim cancellation when the distinguishing current-context read is unavailable', async () => {
    mock.read.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    const user = await uncertainUpload();
    await user.click(screen.getByRole('button', { name: copy.cancelUpload }));
    expect(screen.queryByText(copy.canceledUpload)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.accessLost)).not.toBeInTheDocument();
    expect(body()).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: copy.reload })).toBeEnabled();
    expect(screen.getByText(copy.refreshRequired)).toBeVisible();
  });
  it('reconciles a refreshed pending intent that completed before its cancel click', async () => {
    const pending = composeUiDraft({
      kind: 'photo',
      body: null,
      pendingUploadIds: [ids.upload],
    });
    const completed = {
      ...pending,
      revision: 2,
      pendingUploadIds: [],
      media: [
        {
          id: ids.media,
          kind: 'photo' as const,
          width: 2,
          height: 2,
          durationMs: null,
        },
      ],
    };
    mock.revoke.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    mock.read.mockResolvedValue({
      ok: true,
      data: composeUiPage({ selectedDraft: completed, drafts: [completed] }),
    });
    const user = userEvent.setup();
    render(
      subject(composeUiPage({ selectedDraft: pending, drafts: [pending] })),
    );
    await user.click(screen.getByRole('button', { name: copy.clearPending }));
    expect(screen.getByText(copy.canceledUpload)).toBeVisible();
    expect(screen.getByTestId('secure-media')).toHaveTextContent(ids.media);
    expect(screen.queryByText(copy.accessLost)).not.toBeInTheDocument();
  });
});

describe('Next native history and cached composer restoration', () => {
  it('reconciles cached empty RSC props against the saved draft URL on remount', async () => {
    const draft = composeUiDraft({ kind: 'voice', body: '허구 미디어 안내' });
    window.history.replaceState(
      {},
      '',
      artistComposePath(composeUiPage().artist.slug, draft.id),
    );
    mock.read.mockResolvedValue({
      ok: true,
      data: composeUiPage({ selectedDraft: draft, drafts: [draft] }),
    });
    render(subject(composeUiPage()));
    await waitFor(() => expect(body()).toHaveValue(draft.body));
    expect(mock.read.mock.calls[0]![0]).toMatchObject({ messageId: draft.id });
    expect(
      document.querySelector(`[data-message-id="${draft.id}"]`),
    ).toBeInTheDocument();
    expect(mock.save).not.toHaveBeenCalled();
  });
  it('does not reload an outgoing composer or replace the artist menu URL on Back', async () => {
    const draft = composeUiDraft();
    render(subject(composeUiPage({ selectedDraft: draft, drafts: [draft] })));
    window.history.replaceState({}, '', routes.artist);
    await act(async () => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(mock.read).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(routes.artist);
    expect(
      screen.queryByRole('textbox', { name: copy.body }),
    ).not.toBeInTheDocument();
  });
  it('suppresses an in-flight restored draft response after leaving its exact pathname', async () => {
    const restored = deferred<ComposeResult<ComposePageData>>();
    const draft = composeUiDraft();
    window.history.replaceState(
      {},
      '',
      artistComposePath(composeUiPage().artist.slug, draft.id),
    );
    mock.read.mockReturnValue(restored.promise);
    render(subject());
    expect(mock.read).toHaveBeenCalledOnce();
    window.history.replaceState({}, '', routes.artist);
    await act(async () => window.dispatchEvent(new PopStateEvent('popstate')));
    await act(async () =>
      restored.resolve({
        ok: true,
        data: composeUiPage({ selectedDraft: draft, drafts: [draft] }),
      }),
    );
    expect(window.location.pathname).toBe(routes.artist);
    expect(
      screen.queryByRole('textbox', { name: copy.body }),
    ).not.toBeInTheDocument();
  });
  it('never copies Next private history markers into application-origin replaceState calls', async () => {
    const user = userEvent.setup();
    window.history.replaceState(
      { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['opaque'] },
      '',
      artistComposePath(composeUiPage().artist.slug),
    );
    const replace = vi.spyOn(window.history, 'replaceState');
    render(subject());
    fireEvent.change(body(), { target: { value: '역사 상태 동기화' } });
    await user.click(save());
    expect(replace).toHaveBeenCalled();
    for (const [state] of replace.mock.calls) expect(state).toBeNull();
  });
  it('revalidates bfcache restoration against the current draft URL and rejects lost ownership', async () => {
    const draft = composeUiDraft();
    render(subject(composeUiPage({ selectedDraft: draft, drafts: [draft] })));
    mock.read.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    await act(async () =>
      window.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true }),
      ),
    );
    expect(mock.read.mock.calls[0]![0]).toMatchObject({ messageId: draft.id });
    expect(screen.getByText(copy.accessLost)).toBeVisible();
  });
});

it('offers an explicit current-resource retry if cached-route restoration cannot read the draft', async () => {
  const draft = composeUiDraft({ body: '복구한 저장 내용' });
  window.history.replaceState(
    {},
    '',
    artistComposePath(composeUiPage().artist.slug, draft.id),
  );
  mock.read
    .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
    .mockResolvedValueOnce({
      ok: true,
      data: composeUiPage({ selectedDraft: draft, drafts: [draft] }),
    });
  const user = userEvent.setup();
  render(subject());
  await screen.findByText(copy.errors.UNAVAILABLE);
  await user.click(screen.getByRole('button', { name: copy.reload }));
  expect(body()).toHaveValue(draft.body);
  expect(mock.save).not.toHaveBeenCalled();
  expect(mock.read.mock.calls.map(([input]) => input.messageId)).toEqual([
    draft.id,
    draft.id,
  ]);
});
