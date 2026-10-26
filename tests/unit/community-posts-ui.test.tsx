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
import { CommunityBoard } from '@/components/community-posts/CommunityBoard';
import { CommunityComposer } from '@/components/community-posts/CommunityComposer';
import { CommunityPostDetail } from '@/components/community-posts/CommunityPostDetail';
import { CommunityErrorScreen } from '@/components/community-posts/CommunityErrorScreen';
import { DialogProvider } from '@/components/ui/DialogProvider';
import {
  communityBoardPath,
  communityCreatePath,
  communityPostPath,
} from '@/config/routes';
import type { CommunityCreateInput } from '@/config/community-posts';
import messages from '@/messages/ko.json';
import {
  boardActorId,
  boardArtist,
  boardList,
  boardDetail,
  boardDeleted,
  boardImage,
  boardOtherId,
} from './community-posts-fixtures';
const mock = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  notice: vi.fn(),
  begin: vi.fn(),
  upload: vi.fn(),
  complete: vi.fn(),
  revoke: vi.fn(),
  read: vi.fn(),
  navigate: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/components/community-interactions/CommunityInteractions', () => ({
  CommunityInteractions: () => null,
}));
vi.mock('@/client/community-posts', () => ({
  fetchCommunityPosts: mock.list,
  fetchCommunityPost: mock.detail,
  createCommunityPost: mock.create,
  deleteCommunityPost: mock.remove,
  setCommunityNotice: mock.notice,
}));
vi.mock('@/client/community-media', () => ({
  beginCommunityImage: mock.begin,
  uploadCommunityImage: mock.upload,
  completeCommunityImage: mock.complete,
  revokeCommunityImage: mock.revoke,
  readCommunityImage: mock.read,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mock.navigate, refresh: mock.refresh }),
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
const copy = messages.communityPosts;
const ok = <T,>(data: T) => ({ ok: true as const, data });
const wrapper = (children: ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
    <DialogProvider>{children}</DialogProvider>
  </NextIntlClientProvider>
);
function board() {
  const path = communityBoardPath(boardArtist.slug);
  window.history.replaceState(null, '', path);
  return render(
    wrapper(
      <CommunityBoard
        query={{ slug: boardArtist.slug, cursor: null }}
        actorKey={boardActorId}
        path={path}
      />,
    ),
  );
}
function compose() {
  const path = communityCreatePath(boardArtist.slug);
  window.history.replaceState(null, '', path);
  return render(
    wrapper(
      <CommunityComposer
        slug={boardArtist.slug}
        actorKey={boardActorId}
        path={path}
      />,
    ),
  );
}
function detail() {
  const path = communityPostPath(boardArtist.slug, boardDetail.post.id);
  window.history.replaceState(null, '', path);
  return render(
    wrapper(
      <CommunityPostDetail
        slug={boardArtist.slug}
        postId={boardDetail.post.id}
        actorKey={boardActorId}
        path={path}
      />,
    ),
  );
}
async function fill() {
  await screen.findByLabelText(copy.titleLabel);
  fireEvent.change(screen.getByLabelText(copy.titleLabel), {
    target: { value: '새로운 이야기' },
  });
  fireEvent.change(screen.getByLabelText(copy.bodyLabel), {
    target: { value: '오늘도 응원해요. {이름}' },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.list.mockResolvedValue(ok(boardList));
  mock.detail.mockResolvedValue(ok(boardDetail));
  mock.create.mockImplementation(
    async (_slug: string, input: CommunityCreateInput) =>
      ok({ id: input.post_id, artist_id: input.artist_id, revision: 1 }),
  );
  mock.remove.mockResolvedValue(ok(boardDeleted));
  mock.notice.mockResolvedValue(
    ok({
      id: boardDetail.post.id,
      artist_id: boardArtist.id,
      revision: 2,
      is_notice: true,
      is_pinned: true,
    }),
  );
  mock.begin.mockResolvedValue(
    ok({
      uploadId: boardOtherId,
      uploadUrl: 'https://storage.example/upload',
      expiresAt: '2026-10-25T11:00:00Z',
    }),
  );
  mock.upload.mockResolvedValue(ok(null));
  mock.complete.mockResolvedValue(ok({ imageId: boardImage.id }));
  mock.revoke.mockResolvedValue(ok(null));
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
});
it('renders literal board and owner metadata with links but no unsupported actions', async () => {
  board();
  expect(await screen.findByTestId('community-post-list')).toBeVisible();
  expect(
    screen.getByRole('link', { name: boardDetail.post.title }),
  ).toHaveAttribute(
    'href',
    communityPostPath(boardArtist.slug, boardDetail.post.id),
  );
  expect(screen.getByRole('link', { name: copy.create })).toHaveAttribute(
    'data-prefetch',
    'false',
  );
  expect(
    screen.queryByRole('button', { name: /좋아요|신고|댓글/ }),
  ).not.toBeInTheDocument();
  expect(mock.list).toHaveBeenCalledWith(
    { slug: boardArtist.slug, cursor: null },
    expect.any(AbortSignal),
    boardActorId,
  );
});
it('renders empty board and handles explicit read retry', async () => {
  mock.list
    .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
    .mockResolvedValueOnce(ok({ ...boardList, posts: [] }));
  board();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    copy.errors.UNAVAILABLE,
  );
  fireEvent.click(screen.getByRole('button', { name: messages.ui.retry }));
  expect(await screen.findByText(copy.emptyTitle)).toBeVisible();
  expect(mock.list).toHaveBeenCalledTimes(2);
});
it('clears stale board on authority loss and ignores late old results after navigation', async () => {
  let resolve: (value: unknown) => void = () => {};
  mock.list.mockResolvedValueOnce(ok(boardList)).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  board();
  await screen.findByTestId('community-post-list');
  fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
  expect(screen.queryByTestId('community-post-list')).not.toBeInTheDocument();
  act(() => {
    window.history.replaceState(null, '', '/different');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await act(async () => resolve(ok(boardList)));
  expect(screen.queryByTestId('community-post-list')).not.toBeInTheDocument();
});
it('creates with exact account and literal content then replaces with exact detail route', async () => {
  compose();
  await fill();
  fireEvent.click(screen.getByRole('button', { name: copy.createSave }));
  await waitFor(() => expect(mock.create).toHaveBeenCalledOnce());
  const input = mock.create.mock.calls[0]![1];
  expect(input).toMatchObject({
    artist_id: boardArtist.id,
    title: '새로운 이야기',
    body: '오늘도 응원해요. {이름}',
    upload_ids: [],
    is_notice: false,
    is_pinned: false,
  });
  expect(mock.create.mock.calls[0]![3]).toBe(boardActorId);
  await waitFor(() =>
    expect(mock.navigate).toHaveBeenCalledWith(
      communityPostPath(boardArtist.slug, input.post_id),
    ),
  );
});
it('freezes unknown create intent, preserves it through read retry and replays exactly once on explicit confirmation', async () => {
  mock.create.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  compose();
  await fill();
  fireEvent.click(screen.getByRole('button', { name: copy.createSave }));
  await screen.findByText(copy.uncertain);
  const first = mock.create.mock.calls[0]![1];
  expect(screen.getByLabelText(copy.titleLabel)).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: messages.ui.retry }));
  await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText(copy.titleLabel)).toBeDisabled();
  expect(mock.create).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: copy.retryOperation }));
  await waitFor(() => expect(mock.create).toHaveBeenCalledTimes(2));
  expect(mock.create.mock.calls[1]![1]).toEqual(first);
});
it('keeps unsaved text through focus revalidation but clears it when mounted account loses access', async () => {
  compose();
  await fill();
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText(copy.bodyLabel)).toHaveValue(
    '오늘도 응원해요. {이름}',
  );
  mock.list.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
  act(() => window.dispatchEvent(new Event('focus')));
  await screen.findByText(copy.errors.FORBIDDEN);
  expect(screen.queryByTestId('community-post-form')).not.toBeInTheDocument();
  expect(mock.create).not.toHaveBeenCalled();
});
it('does not publish invalid text or begin upload for disallowed file bytes', async () => {
  compose();
  await fill();
  fireEvent.change(screen.getByLabelText(copy.bodyLabel), {
    target: { value: 'x'.repeat(boardList.policy.max_body_length + 1) },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.createSave }));
  await screen.findByText(copy.errors.INVALID_INPUT);
  expect(mock.create).not.toHaveBeenCalled();
  const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
  fireEvent.change(screen.getByLabelText(copy.imageLabel), {
    target: { files: [file] },
  });
  expect(await screen.findByText(copy.errors.INVALID_CONTENT)).toBeVisible();
  expect(mock.begin).not.toHaveBeenCalled();
});
it('stages verified image before publishing and includes only verified upload IDs', async () => {
  compose();
  await fill();
  const file = new File(['photo'], 'photo.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText(copy.imageLabel), {
    target: { files: [file] },
  });
  expect(screen.getByRole('button', { name: copy.createSave })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: copy.upload }));
  await screen.findByText(copy.uploadVerified);
  expect(mock.upload).toHaveBeenCalledOnce();
  expect(mock.complete).toHaveBeenCalledWith(
    { uploadId: boardOtherId },
    expect.any(AbortSignal),
    boardActorId,
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: copy.createSave })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: copy.createSave }));
  await waitFor(() => expect(mock.create).toHaveBeenCalledOnce());
  expect(mock.create.mock.calls[0]![1].upload_ids).toEqual([boardOtherId]);
  expect(mock.begin.mock.calls[0]![0].postId).toBe(
    mock.create.mock.calls[0]![1].post_id,
  );
});
it('lost storage PUT response never repeats PUT and explicitly completes the same upload', async () => {
  mock.upload.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  compose();
  await fill();
  fireEvent.change(screen.getByLabelText(copy.imageLabel), {
    target: {
      files: [new File(['photo'], 'photo.png', { type: 'image/png' })],
    },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.upload }));
  await screen.findByText(copy.uploadUncertain);
  expect(mock.complete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: copy.uploadRetry }));
  await screen.findByText(copy.uploadVerified);
  expect(mock.upload).toHaveBeenCalledOnce();
  expect(mock.begin).toHaveBeenCalledOnce();
  expect(mock.complete).toHaveBeenCalledOnce();
});
it('unknown begin cancellation recovers same request then confirms revoke before removing intent', async () => {
  mock.begin.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  compose();
  await fill();
  fireEvent.change(screen.getByLabelText(copy.imageLabel), {
    target: {
      files: [new File(['photo'], 'photo.png', { type: 'image/png' })],
    },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.upload }));
  await screen.findByText(copy.uploadUncertain);
  const original = mock.begin.mock.calls[0]![0];
  fireEvent.click(screen.getByRole('button', { name: copy.uploadCancel }));
  await waitFor(() => expect(mock.revoke).toHaveBeenCalledOnce());
  expect(mock.begin.mock.calls[1]![0]).toEqual(original);
  expect(mock.upload).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: copy.createSave })).toBeEnabled(),
  );
});
it('owner delete requires confirmation and can be canceled without a write', async () => {
  detail();
  await screen.findByTestId('community-post-detail');
  fireEvent.click(screen.getByRole('button', { name: copy.deleteAction }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(
    within(dialog).getByRole('button', { name: copy.deleteDialogCancel }),
  );
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(mock.remove).not.toHaveBeenCalled();
  expect(screen.getByText(boardDetail.post.body)).toBeVisible();
});
it('confirmed delete hides private post and remains on detail route with status', async () => {
  detail();
  await screen.findByTestId('community-post-detail');
  fireEvent.click(screen.getByRole('button', { name: copy.deleteAction }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(
    within(dialog).getByRole('button', { name: copy.deleteDialogConfirm }),
  );
  await screen.findByText(copy.deleted);
  expect(screen.queryByText(boardDetail.post.body)).not.toBeInTheDocument();
  expect(mock.remove.mock.calls[0]![1]).toMatchObject({
    post_id: boardDetail.post.id,
    expected_revision: 1,
    confirmed: true,
  });
  expect(mock.navigate).not.toHaveBeenCalled();
});
it('cancels stale delete dialog on focus and does not send delete', async () => {
  detail();
  await screen.findByTestId('community-post-detail');
  fireEvent.click(screen.getByRole('button', { name: copy.deleteAction }));
  await screen.findByRole('dialog');
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(mock.remove).not.toHaveBeenCalled();
});
it('unknown delete retries original operation rather than opening another dialog', async () => {
  mock.remove.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  detail();
  await screen.findByTestId('community-post-detail');
  fireEvent.click(screen.getByRole('button', { name: copy.deleteAction }));
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: copy.deleteDialogConfirm,
    }),
  );
  await screen.findByTestId('community-post-recovery');
  const original = mock.remove.mock.calls[0]![1];
  fireEvent.click(screen.getByRole('button', { name: copy.retryOperation }));
  await screen.findByText(copy.deleted);
  expect(mock.remove.mock.calls[1]![1]).toEqual(original);
});
it('nonowner has no delete and nonadmin has no notice controls', async () => {
  mock.detail.mockResolvedValue(
    ok({ ...boardDetail, post: { ...boardDetail.post, is_owner: false } }),
  );
  detail();
  await screen.findByTestId('community-post-detail');
  expect(
    screen.queryByRole('button', { name: copy.deleteAction }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText(copy.noticeLabel)).not.toBeInTheDocument();
});
it('admin notice optimistic conflict refresh resets edited flags to latest server snapshot', async () => {
  mock.detail.mockResolvedValue(
    ok({ ...boardDetail, can_create_notice: true }),
  );
  mock.notice.mockResolvedValueOnce({ ok: false, code: 'CONFLICT' });
  detail();
  await screen.findByTestId('community-post-detail');
  fireEvent.click(screen.getByLabelText(copy.noticeLabel));
  fireEvent.click(screen.getByLabelText(copy.pinnedLabel));
  fireEvent.click(screen.getByRole('button', { name: copy.saveNotice }));
  await screen.findByText(copy.errors.CONFLICT);
  fireEvent.click(screen.getByRole('button', { name: messages.ui.retry }));
  await waitFor(() => expect(mock.detail).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText(copy.noticeLabel)).not.toBeChecked();
  expect(screen.getByLabelText(copy.pinnedLabel)).toBeDisabled();
  expect(mock.notice).toHaveBeenCalledTimes(1);
});
it('notice unknown outcome keeps exact operation across refresh and does not silently resend', async () => {
  mock.detail.mockResolvedValue(
    ok({ ...boardDetail, can_create_notice: true }),
  );
  mock.notice.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  detail();
  await screen.findByTestId('community-post-detail');
  fireEvent.click(screen.getByLabelText(copy.noticeLabel));
  fireEvent.click(screen.getByLabelText(copy.pinnedLabel));
  fireEvent.click(screen.getByRole('button', { name: copy.saveNotice }));
  await screen.findByText(copy.uncertain);
  const original = mock.notice.mock.calls[0]![1];
  fireEvent.click(screen.getByRole('button', { name: messages.ui.retry }));
  await waitFor(() => expect(mock.detail).toHaveBeenCalledTimes(2));
  expect(mock.notice).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: copy.retryOperation }));
  await waitFor(() => expect(mock.notice).toHaveBeenCalledTimes(2));
  expect(mock.notice.mock.calls[1]![1]).toEqual(original);
});
it('renders setup error with real router refresh and no private data', () => {
  render(wrapper(<CommunityErrorScreen code="SETUP_NOT_READY" />));
  fireEvent.click(screen.getByRole('button', { name: messages.ui.retry }));
  expect(mock.refresh).toHaveBeenCalledOnce();
  expect(screen.queryByTestId('community-post-list')).not.toBeInTheDocument();
});

it('shows admin notice options on create without granting them to fans', async () => {
  mock.list.mockResolvedValue(ok({ ...boardList, can_create_notice: true }));
  compose();
  await fill();
  expect(screen.getByLabelText(copy.pinnedLabel)).toBeDisabled();
  fireEvent.click(screen.getByLabelText(copy.noticeLabel));
  fireEvent.click(screen.getByLabelText(copy.pinnedLabel));
  fireEvent.click(screen.getByRole('button', { name: copy.createSave }));
  await waitFor(() => expect(mock.create).toHaveBeenCalledOnce());
  expect(mock.create.mock.calls[0]![1]).toMatchObject({
    is_notice: true,
    is_pinned: true,
  });
});
it('zero image policy is explicit and cannot open an upload', async () => {
  mock.list.mockResolvedValue(
    ok({ ...boardList, policy: { ...boardList.policy, max_images: 0 } }),
  );
  compose();
  await fill();
  expect(screen.getByText(copy.imagesDisabled)).toBeVisible();
  expect(screen.queryByLabelText(copy.imageLabel)).not.toBeInTheDocument();
  expect(mock.begin).not.toHaveBeenCalled();
});
it('unknown revoke retries revoke, not upload or completion', async () => {
  mock.revoke.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  compose();
  await fill();
  fireEvent.change(screen.getByLabelText(copy.imageLabel), {
    target: {
      files: [new File(['photo'], 'photo.png', { type: 'image/png' })],
    },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.upload }));
  await screen.findByText(copy.uploadVerified);
  fireEvent.click(screen.getByRole('button', { name: '사진 1 빼기' }));
  await screen.findByText(copy.uploadUncertain);
  fireEvent.click(screen.getByRole('button', { name: copy.uploadRetry }));
  await waitFor(() => expect(mock.revoke).toHaveBeenCalledTimes(2));
  expect(mock.revoke.mock.calls[1]![0]).toEqual(mock.revoke.mock.calls[0]![0]);
  expect(mock.upload).toHaveBeenCalledOnce();
  expect(mock.complete).toHaveBeenCalledOnce();
  await waitFor(() =>
    expect(screen.queryByText(copy.uploadVerified)).not.toBeInTheDocument(),
  );
});
it('focus interrupts completion without losing exact staged upload or resending bytes', async () => {
  let complete: (value: unknown) => void = () => {};
  mock.complete.mockImplementationOnce(
    () =>
      new Promise((done) => {
        complete = done;
      }),
  );
  compose();
  await fill();
  fireEvent.change(screen.getByLabelText(copy.imageLabel), {
    target: {
      files: [new File(['photo'], 'photo.png', { type: 'image/png' })],
    },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.upload }));
  await waitFor(() => expect(mock.complete).toHaveBeenCalledOnce());
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2));
  await screen.findByText(copy.uploadUncertain);
  await act(async () => complete(ok({ imageId: boardImage.id })));
  expect(screen.queryByText(copy.uploadVerified)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: copy.uploadRetry }));
  await screen.findByText(copy.uploadVerified);
  expect(mock.upload).toHaveBeenCalledOnce();
  expect(mock.complete).toHaveBeenCalledTimes(2);
  expect(mock.complete.mock.calls[1]![0]).toEqual(
    mock.complete.mock.calls[0]![0],
  );
});
it('does not expose image URLs until explicit open and clears them synchronously on focus', async () => {
  mock.detail.mockResolvedValue(
    ok({
      ...boardDetail,
      post: { ...boardDetail.post, image_count: 1, images: [boardImage] },
    }),
  );
  mock.read.mockResolvedValue(
    ok({
      url: 'https://example.invalid/photo.png?token=private',
      expiresAt: new Date(Date.now() + 30000).toISOString(),
      mimeType: 'image/png',
    }),
  );
  detail();
  await screen.findByTestId('community-post-detail');
  expect(mock.read).not.toHaveBeenCalled();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '사진 1 보기' }));
  expect(await screen.findByRole('img')).toHaveAttribute(
    'src',
    'https://example.invalid/photo.png?token=private',
  );
  const image = screen.getByRole('img');
  act(() => window.dispatchEvent(new Event('focus')));
  expect(image).not.toHaveAttribute('src');
  await waitFor(() =>
    expect(screen.queryByRole('img')).not.toBeInTheDocument(),
  );
  expect(mock.read).toHaveBeenCalledOnce();
});
it('wrong image MIME and authority denial never expose capability URLs', async () => {
  mock.detail.mockResolvedValue(
    ok({
      ...boardDetail,
      post: { ...boardDetail.post, image_count: 1, images: [boardImage] },
    }),
  );
  mock.read
    .mockResolvedValueOnce(
      ok({
        url: 'https://example.invalid/photo.png?token=private',
        expiresAt: new Date(Date.now() + 30000).toISOString(),
        mimeType: 'image/jpeg',
      }),
    )
    .mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
  detail();
  await screen.findByTestId('community-post-detail');
  fireEvent.click(screen.getByRole('button', { name: '사진 1 보기' }));
  await screen.findByText(copy.errors.UNAVAILABLE);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '사진 1 보기' }));
  await screen.findByText(copy.errors.FORBIDDEN);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByTestId('community-post-detail')).not.toBeInTheDocument();
  expect(screen.queryByText(boardDetail.post.body)).not.toBeInTheDocument();
});
it.each(['NOT_FOUND', 'SETUP_NOT_READY'])(
  'read %s clears cached form and frozen mutation instead of retaining hidden private controls',
  async (code) => {
    compose();
    await fill();
    mock.list.mockResolvedValue({ ok: false, code });
    act(() => window.dispatchEvent(new Event('focus')));
    await screen.findByText(copy.errors[code as keyof typeof copy.errors]);
    expect(screen.queryByTestId('community-post-form')).not.toBeInTheDocument();
    expect(
      screen.queryByDisplayValue('오늘도 응원해요. {이름}'),
    ).not.toBeInTheDocument();
  },
);
it.each(['upload', 'cancel'])(
  'confirmed expired begin permits safe new selection on %s path without sending bytes',
  async (action) => {
    mock.begin
      .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
      .mockResolvedValueOnce({ ok: false, code: 'EXPIRED' });
    compose();
    await fill();
    fireEvent.change(screen.getByLabelText(copy.imageLabel), {
      target: {
        files: [new File(['photo'], 'photo.png', { type: 'image/png' })],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.upload }));
    await screen.findByText(copy.uploadUncertain);
    fireEvent.click(
      screen.getByRole('button', {
        name: action === 'cancel' ? copy.uploadCancel : copy.uploadRetry,
      }),
    );
    await screen.findByText(copy.errors.EXPIRED);
    await waitFor(() =>
      expect(screen.getByLabelText(copy.imageLabel)).toBeEnabled(),
    );
    expect(mock.upload).not.toHaveBeenCalled();
    expect(mock.complete).not.toHaveBeenCalled();
    expect(mock.revoke).not.toHaveBeenCalled();
    expect(mock.create).not.toHaveBeenCalled();
  },
);

it('explicit composer cancel revokes every completed policy-limit reservation before navigating', async () => {
  const ids = [
    'b4000000-0000-4000-8000-000000000010',
    'b4000000-0000-4000-8000-000000000011',
    'b4000000-0000-4000-8000-000000000012',
  ];
  let index = 0;
  mock.begin.mockImplementation(async () =>
    ok({
      uploadId: ids[index++]!,
      uploadUrl: 'https://storage.example/upload',
      expiresAt: '2026-10-25T11:00:00Z',
    }),
  );
  mock.revoke.mockImplementation(async () => {
    expect(mock.navigate).not.toHaveBeenCalled();
    return ok(null);
  });
  compose();
  await fill();
  for (let count = 0; count < boardList.policy.max_images; count += 1) {
    fireEvent.change(screen.getByLabelText(copy.imageLabel), {
      target: {
        files: [
          new File(['photo'], `photo${count}.png`, { type: 'image/png' }),
        ],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: copy.upload }));
    await waitFor(() =>
      expect(screen.getAllByText(copy.uploadVerified)).toHaveLength(count + 1),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: copy.createSave }),
      ).toBeEnabled(),
    );
  }
  expect(screen.getByLabelText(copy.imageLabel)).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: copy.cancel }));
  await waitFor(() =>
    expect(mock.navigate).toHaveBeenCalledWith(
      communityBoardPath(boardArtist.slug),
    ),
  );
  expect(mock.revoke.mock.calls.map((call) => call[0].uploadId)).toEqual(ids);
  expect(mock.create).not.toHaveBeenCalled();
  expect(screen.queryByTestId('community-post-form')).not.toBeInTheDocument();
});
it('explicit back cleanup freezes uncertain revoke and retries the original reservation before navigation', async () => {
  mock.revoke.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  compose();
  await fill();
  fireEvent.change(screen.getByLabelText(copy.imageLabel), {
    target: {
      files: [new File(['photo'], 'photo.png', { type: 'image/png' })],
    },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.upload }));
  await screen.findByText(copy.uploadVerified);
  fireEvent.click(screen.getByRole('button', { name: copy.backBoard }));
  await screen.findByTestId('community-draft-cancel-recovery');
  expect(mock.navigate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: copy.createSave })).toBeDisabled();
  expect(screen.getByLabelText(copy.titleLabel)).toBeDisabled();
  const first = mock.revoke.mock.calls[0]![0];
  fireEvent.click(screen.getByRole('button', { name: copy.cancelRetry }));
  await waitFor(() =>
    expect(mock.navigate).toHaveBeenCalledWith(
      communityBoardPath(boardArtist.slug),
    ),
  );
  expect(mock.revoke).toHaveBeenCalledTimes(2);
  expect(mock.revoke.mock.calls[1]![0]).toEqual(first);
  expect(mock.upload).toHaveBeenCalledOnce();
});
it('explicit cancel reconciles lost begin with original request then revokes without sending file bytes', async () => {
  mock.begin.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  compose();
  await fill();
  fireEvent.change(screen.getByLabelText(copy.imageLabel), {
    target: {
      files: [new File(['photo'], 'photo.png', { type: 'image/png' })],
    },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.upload }));
  await screen.findByText(copy.uploadUncertain);
  const original = mock.begin.mock.calls[0]![0];
  fireEvent.click(screen.getByRole('button', { name: copy.cancel }));
  await waitFor(() =>
    expect(mock.navigate).toHaveBeenCalledWith(
      communityBoardPath(boardArtist.slug),
    ),
  );
  expect(mock.begin.mock.calls[1]![0]).toEqual(original);
  expect(mock.revoke).toHaveBeenCalledExactlyOnceWith(
    { uploadId: boardOtherId },
    expect.any(AbortSignal),
    boardActorId,
  );
  expect(mock.upload).not.toHaveBeenCalled();
  expect(mock.create).not.toHaveBeenCalled();
});
it('unknown create outcome forbids cancellation cleanup of potentially attached images', async () => {
  mock.create.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  compose();
  await fill();
  fireEvent.change(screen.getByLabelText(copy.imageLabel), {
    target: {
      files: [new File(['photo'], 'photo.png', { type: 'image/png' })],
    },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.upload }));
  await screen.findByText(copy.uploadVerified);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: copy.createSave })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: copy.createSave }));
  await screen.findByText(copy.uncertain);
  expect(screen.getByRole('button', { name: copy.cancel })).toBeDisabled();
  expect(screen.getByRole('button', { name: copy.backBoard })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: copy.cancel }));
  fireEvent.click(screen.getByRole('button', { name: copy.backBoard }));
  expect(mock.revoke).not.toHaveBeenCalled();
  expect(mock.navigate).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: copy.checkCreated })).toBeVisible();
});
it('focus during explicit draft cleanup keeps revoke recoverable and cannot navigate from a stale response', async () => {
  let finish: (value: unknown) => void = () => {};
  mock.revoke.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  compose();
  await fill();
  fireEvent.change(screen.getByLabelText(copy.imageLabel), {
    target: {
      files: [new File(['photo'], 'photo.png', { type: 'image/png' })],
    },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.upload }));
  await screen.findByText(copy.uploadVerified);
  fireEvent.click(screen.getByRole('button', { name: copy.cancel }));
  await waitFor(() => expect(mock.revoke).toHaveBeenCalledOnce());
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2));
  await act(async () => finish(ok(null)));
  await screen.findByTestId('community-draft-cancel-recovery');
  expect(mock.navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: copy.cancelRetry }));
  await waitFor(() =>
    expect(mock.navigate).toHaveBeenCalledWith(
      communityBoardPath(boardArtist.slug),
    ),
  );
  expect(mock.revoke.mock.calls[1]![0]).toEqual(mock.revoke.mock.calls[0]![0]);
});
