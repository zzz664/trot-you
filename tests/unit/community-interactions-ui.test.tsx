import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import {
  useCallback,
  useState,
  type AnchorHTMLAttributes,
  type ReactNode,
} from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CommunityInteractions } from '@/components/community-interactions/CommunityInteractions';
import { CommunityPostDetail } from '@/components/community-posts/CommunityPostDetail';
import { DialogProvider } from '@/components/ui/DialogProvider';
import { communityPostPath } from '@/config/routes';
import type { CommunityDetail, CommunityError } from '@/config/community-posts';
import type { CommunityInteractions as InteractionData } from '@/config/community-interactions';
import messages from '@/messages/ko.json';
import {
  boardActorId,
  boardOtherId,
  boardArtist,
  boardDetail,
  boardImage,
} from './community-posts-fixtures';

const mock = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  like: vi.fn(),
  detail: vi.fn(),
  postDelete: vi.fn(),
  notice: vi.fn(),
  read: vi.fn(),
  changed: vi.fn(),
  lost: vi.fn(),
  busy: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@/client/community-interactions', () => ({
  fetchCommunityInteractions: mock.list,
  createCommunityComment: mock.create,
  updateCommunityComment: mock.update,
  deleteCommunityComment: mock.remove,
  setCommunityLike: mock.like,
}));
vi.mock('@/client/community-posts', () => ({
  fetchCommunityPost: mock.detail,
  deleteCommunityPost: mock.postDelete,
  setCommunityNotice: mock.notice,
}));
vi.mock('@/client/community-media', () => ({ readCommunityImage: mock.read }));
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
const copy = messages.communityInteractions;
const postCopy = messages.communityPosts;
const ok = <T,>(data: T) => ({ ok: true as const, data });
const commentId = 'b5000000-0000-4000-8000-000000000001';
const secondId = 'b5000000-0000-4000-8000-000000000002';
const comment = {
  id: commentId,
  post_id: boardDetail.post.id,
  author: { call_name: '팬님' },
  is_owner: true,
  body: '함께 응원해요. {이름}',
  created_at: '2026-10-25T10:00:00.000001Z',
  updated_at: '2026-10-25T10:00:00.000001Z',
  revision: 7,
};
const other = {
  ...comment,
  id: secondId,
  is_owner: false,
  author: { call_name: null },
  body: '다른 팬의 이야기',
  created_at: '2026-10-25T10:00:00.000002Z',
};
const initial: InteractionData = {
  actor_id: boardActorId,
  post_id: boardDetail.post.id,
  policy: { max_comment_length: 100 },
  like_count: 2,
  comment_count: 2,
  liked: false,
  comments: [comment, other],
  next_cursor: null,
};
let fresh: InteractionData;
const path = communityPostPath(boardArtist.slug, boardDetail.post.id);
const wrapper = (children: ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
    <DialogProvider>{children}</DialogProvider>
  </NextIntlClientProvider>
);
function Harness({
  actor = boardActorId,
  snapshot = boardDetail,
  error = null,
}: {
  actor?: string;
  snapshot?: CommunityDetail | null;
  error?: CommunityError | null;
}) {
  const [generation, setGeneration] = useState(0);
  const [current, setCurrent] = useState(snapshot);
  const changed = useCallback(async () => {
    mock.changed();
    setGeneration((value) => value + 1);
    setCurrent((value) =>
      value
        ? {
            ...value,
            post: { ...value.post, revision: value.post.revision + 1 },
          }
        : value,
    );
  }, []);
  return (
    <CommunityInteractions
      slug={boardArtist.slug}
      postId={boardDetail.post.id}
      actorKey={actor}
      path={path}
      parentSnapshot={generation === 0 ? snapshot : current}
      parentError={error}
      disabled={false}
      onAccessLost={mock.lost}
      onChanged={changed}
      onBusyChange={mock.busy}
    />
  );
}
function panel() {
  window.history.replaceState(null, '', path);
  return render(wrapper(<Harness />));
}
function detail() {
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
async function loaded() {
  await screen.findByTestId('community-interactions-content');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: copy.like })).toBeEnabled(),
  );
}
function fill(value = '새 댓글 {이름}') {
  fireEvent.change(screen.getByLabelText(copy.bodyLabel), {
    target: { value },
  });
}
async function edit(value = '수정한 댓글') {
  fireEvent.click(screen.getByRole('button', { name: copy.edit }));
  fireEvent.change(screen.getByLabelText(copy.editBodyLabel), {
    target: { value },
  });
}
async function confirmDelete() {
  fireEvent.click(screen.getByRole('button', { name: copy.delete }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(
    within(dialog).getByRole('button', { name: copy.deleteDialogConfirm }),
  );
}
async function start(kind: 'create' | 'update' | 'delete' | 'like') {
  if (kind === 'create') {
    fill();
    fireEvent.click(screen.getByRole('button', { name: copy.create }));
  }
  if (kind === 'update') {
    await edit();
    fireEvent.click(screen.getByRole('button', { name: copy.save }));
  }
  if (kind === 'delete') await confirmDelete();
  if (kind === 'like')
    fireEvent.click(screen.getByRole('button', { name: copy.like }));
}
const writer = (kind: 'create' | 'update' | 'delete' | 'like') =>
  kind === 'delete' ? mock.remove : mock[kind];
beforeEach(() => {
  vi.clearAllMocks();
  fresh = structuredClone(initial);
  mock.list.mockImplementation(async () => ok(fresh));
  mock.create.mockImplementation(async (_slug, input) => {
    fresh = {
      ...fresh,
      comment_count: fresh.comment_count + 1,
      comments: [
        ...fresh.comments,
        {
          ...comment,
          id: input.comment_id,
          body: input.body,
          revision: 1,
          created_at: '2026-10-25T11:00:00Z',
        },
      ],
    };
    return ok({ id: input.comment_id, post_id: input.post_id, revision: 1 });
  });
  mock.update.mockImplementation(async (_slug, input) => {
    fresh = {
      ...fresh,
      comments: fresh.comments.map((row) =>
        row.id === input.comment_id
          ? { ...row, body: input.body, revision: row.revision + 1 }
          : row,
      ),
    };
    return ok({
      id: input.comment_id,
      post_id: input.post_id,
      revision: input.expected_revision + 1,
    });
  });
  mock.remove.mockImplementation(async (_slug, input) => {
    fresh = {
      ...fresh,
      comment_count: fresh.comment_count - 1,
      comments: fresh.comments.filter((row) => row.id !== input.comment_id),
    };
    return ok({ id: input.comment_id, post_id: input.post_id, deleted: true });
  });
  mock.like.mockImplementation(async (_slug, input) => {
    fresh = {
      ...fresh,
      liked: input.liked,
      like_count: fresh.like_count + (input.liked ? 1 : -1),
    };
    return ok({ post_id: input.post_id, liked: input.liked });
  });
  mock.detail.mockImplementation(async () => ok(structuredClone(boardDetail)));
  mock.postDelete.mockResolvedValue(
    ok({ id: boardDetail.post.id, deleted: true }),
  );
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
});
it('shows literal visible comments, public author name, counts and owner-only actions', async () => {
  panel();
  await loaded();
  expect(screen.getByText(comment.body)).toBeVisible();
  expect(
    screen.getByText(copy.author.replace('{name}', copy.anonymousAuthor)),
  ).toBeVisible();
  expect(screen.getAllByRole('button', { name: copy.edit })).toHaveLength(1);
  expect(screen.getByText('좋아요 2개')).toBeVisible();
  expect(mock.list).toHaveBeenCalledWith(
    { slug: boardArtist.slug, post_id: boardDetail.post.id, cursor: null },
    expect.any(AbortSignal),
    boardActorId,
  );
  expect(screen.queryByText(boardActorId)).not.toBeInTheDocument();
});
it('renders an empty current page without inventing comments or counts', async () => {
  fresh = { ...fresh, comments: [], comment_count: 0, like_count: 0 };
  panel();
  await loaded();
  expect(screen.getByText(copy.empty)).toBeVisible();
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
  expect(screen.getByText('댓글 0개')).toBeVisible();
});
it('requires explicit retry after unavailable reads without sending a write', async () => {
  mock.list.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  panel();
  await screen.findByText(postCopy.errors.UNAVAILABLE);
  fireEvent.click(screen.getByRole('button', { name: messages.ui.retry }));
  await loaded();
  expect(mock.list).toHaveBeenCalledTimes(2);
  expect(mock.create).not.toHaveBeenCalled();
});
it.each(['', '   ', 'x'.repeat(101), 'bad\u0000text', 'bad\ud800text'])(
  'rejects invalid authored body %j before networking',
  async (value) => {
    panel();
    await loaded();
    fill(value);
    fireEvent.click(screen.getByRole('button', { name: copy.create }));
    expect(screen.getByText(copy.invalidBody)).toBeVisible();
    expect(mock.create).not.toHaveBeenCalled();
  },
);
it('counts Unicode code points rather than UTF-16 units and preserves exact literal body bytes', async () => {
  fresh = { ...fresh, policy: { max_comment_length: 2 } };
  panel();
  await loaded();
  fill('😀😀');
  fireEvent.click(screen.getByRole('button', { name: copy.create }));
  await screen.findByText(copy.saved);
  expect(mock.create.mock.calls[0]![1]).toMatchObject({
    post_id: boardDetail.post.id,
    body: '😀😀',
  });
  expect(mock.create.mock.calls[0]![3]).toBe(boardActorId);
  expect(mock.changed).toHaveBeenCalledOnce();
  expect(await screen.findByLabelText(copy.bodyLabel)).toHaveValue('');
});
it('sends an explicit desired like state and refreshes counts after a confirmed receipt', async () => {
  panel();
  await loaded();
  fireEvent.click(screen.getByRole('button', { name: copy.like }));
  await screen.findByRole('button', { name: copy.unlike });
  expect(mock.like.mock.calls[0]![1]).toMatchObject({
    post_id: boardDetail.post.id,
    liked: true,
  });
  expect(screen.getByText('좋아요 3개')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: copy.unlike }));
  await screen.findByRole('button', { name: copy.like });
  expect(mock.like.mock.calls[1]![1].liked).toBe(false);
  expect(screen.getByText('좋아요 2개')).toBeVisible();
});
it('never optimistically changes like count or current state before the server responds', async () => {
  let resolve: (value: unknown) => void = () => {};
  mock.like.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  panel();
  await loaded();
  fireEvent.click(screen.getByRole('button', { name: copy.like }));
  expect(screen.getByText('좋아요 2개')).toBeVisible();
  expect(screen.getByRole('button', { name: copy.like })).toBeDisabled();
  await act(async () => resolve({ ok: false, code: 'UNAVAILABLE' }));
  await screen.findByTestId('community-interactions-recovery');
});
it('edits using the displayed revision and cancel does not write', async () => {
  panel();
  await loaded();
  await edit('버릴 수정');
  fireEvent.click(screen.getByRole('button', { name: copy.cancelEdit }));
  expect(mock.update).not.toHaveBeenCalled();
  await edit('새 수정 {이름}');
  fireEvent.click(screen.getByRole('button', { name: copy.save }));
  await screen.findByText(copy.saved);
  expect(mock.update.mock.calls[0]![1]).toMatchObject({
    comment_id: comment.id,
    expected_revision: 7,
    body: '새 수정 {이름}',
  });
  expect(await screen.findByText('새 수정 {이름}')).toBeVisible();
});
it('requires a delete confirmation that can be dismissed without a request', async () => {
  panel();
  await loaded();
  fireEvent.click(screen.getByRole('button', { name: copy.delete }));
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: copy.deleteDialogCancel,
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(mock.remove).not.toHaveBeenCalled();
  expect(screen.getByText(comment.body)).toBeVisible();
});
it('confirmed deletion sends the owner revision and removes the comment only after refresh', async () => {
  panel();
  await loaded();
  await confirmDelete();
  await screen.findByText(copy.deleted);
  expect(mock.remove.mock.calls[0]![1]).toMatchObject({
    comment_id: comment.id,
    expected_revision: 7,
    confirmed: true,
  });
  expect(await screen.findByText('댓글 1개')).toBeVisible();
  expect(screen.queryByText(comment.body)).not.toBeInTheDocument();
});
it.each(['create', 'update', 'delete', 'like'] as const)(
  'freezes uncertain %s intent through read refresh then retries the identical request only explicitly',
  async (kind) => {
    writer(kind).mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    panel();
    await loaded();
    await start(kind);
    await screen.findByTestId('community-interactions-recovery');
    const first = writer(kind).mock.calls[0]![1];
    expect(screen.getByRole('button', { name: copy.create })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
    await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: copy.retryOperation }),
      ).toBeEnabled(),
    );
    expect(writer(kind)).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: copy.retryOperation }));
    await waitFor(() => expect(writer(kind)).toHaveBeenCalledTimes(2));
    expect(writer(kind).mock.calls[1]![1]).toEqual(first);
    expect(writer(kind).mock.calls[1]![3]).toBe(boardActorId);
    await waitFor(() =>
      expect(
        screen.queryByTestId('community-interactions-recovery'),
      ).not.toBeInTheDocument(),
    );
  },
);
it('suppresses repeated create clicks while a transport result is pending', async () => {
  let resolve: (value: unknown) => void = () => {};
  mock.create.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  panel();
  await loaded();
  fill();
  fireEvent.click(screen.getByRole('button', { name: copy.create }));
  fireEvent.click(screen.getByRole('button', { name: copy.create }));
  expect(mock.create).toHaveBeenCalledOnce();
  await act(async () => resolve({ ok: false, code: 'UNAVAILABLE' }));
  await screen.findByTestId('community-interactions-recovery');
});
it.each([
  'FORBIDDEN',
  'UNAUTHENTICATED',
  'NOT_FOUND',
  'SETUP_NOT_READY',
] as const)(
  'clears comment content and notifies the parent on current read %s',
  async (code) => {
    panel();
    await loaded();
    fill('private unsaved');
    mock.list.mockResolvedValue({ ok: false, code });
    fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
    await screen.findByText(postCopy.errors[code]);
    expect(screen.queryByText(comment.body)).not.toBeInTheDocument();
    expect(
      screen.queryByDisplayValue('private unsaved'),
    ).not.toBeInTheDocument();
    expect(mock.lost).toHaveBeenCalledWith(code);
  },
);
it.each(['create', 'update', 'delete', 'like'] as const)(
  'current authority loss during %s purges recovery and parent content instead of showing success',
  async (kind) => {
    writer(kind).mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    panel();
    await loaded();
    await start(kind);
    await waitFor(() => expect(mock.lost).toHaveBeenCalledWith('NOT_FOUND'));
    expect(
      screen.queryByTestId('community-interactions-content'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('community-interactions-recovery'),
    ).not.toBeInTheDocument();
    expect(mock.changed).not.toHaveBeenCalled();
  },
);
it('conflict removes stale comment/editor and requires a fresh read before editing again', async () => {
  mock.update.mockResolvedValueOnce({ ok: false, code: 'CONFLICT' });
  panel();
  await loaded();
  await edit();
  fireEvent.click(screen.getByRole('button', { name: copy.save }));
  await screen.findByText(postCopy.errors.CONFLICT);
  expect(
    screen.queryByTestId('community-comment-editor'),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(comment.body)).not.toBeInTheDocument();
  fresh = {
    ...fresh,
    comments: [{ ...comment, body: '다른 곳에서 수정', revision: 12 }],
  };
  fireEvent.click(screen.getByRole('button', { name: messages.ui.retry }));
  await screen.findByText('다른 곳에서 수정');
  await edit('새 결정');
  fireEvent.click(screen.getByRole('button', { name: copy.save }));
  await waitFor(() => expect(mock.update).toHaveBeenCalledTimes(2));
  expect(mock.update.mock.calls[1]![1].expected_revision).toBe(12);
});
it.each(['CONTENT_BLOCKED', 'RATE_LIMITED'] as const)(
  'definitive %s keeps the draft editable without an uncertain retry',
  async (code) => {
    mock.create.mockResolvedValueOnce({ ok: false, code });
    panel();
    await loaded();
    fill('보존할 초안');
    fireEvent.click(screen.getByRole('button', { name: copy.create }));
    await screen.findByText(postCopy.errors[code]);
    expect(screen.getByLabelText(copy.bodyLabel)).toHaveValue('보존할 초안');
    expect(screen.getByLabelText(copy.bodyLabel)).toBeEnabled();
    expect(
      screen.queryByTestId('community-interactions-recovery'),
    ).not.toBeInTheDocument();
  },
);
it('replaces pages with the exact cursor and cancels any editor before pagination', async () => {
  const next = { created_at: other.created_at, id: other.id };
  fresh = { ...fresh, next_cursor: next };
  panel();
  await loaded();
  await edit();
  fresh = {
    ...fresh,
    comments: [
      {
        ...other,
        id: 'b5000000-0000-4000-8000-000000000003',
        body: '다음 페이지',
      },
    ],
    next_cursor: null,
  };
  fireEvent.click(screen.getByRole('button', { name: copy.nextPage }));
  await screen.findByText('다음 페이지');
  expect(mock.list.mock.calls[1]![0].cursor).toEqual(next);
  expect(screen.queryByText(comment.body)).not.toBeInTheDocument();
  expect(
    screen.queryByTestId('community-comment-editor'),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: copy.firstPage }));
  await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(3));
  expect(mock.list.mock.calls[2]![0].cursor).toBeNull();
});
it('focus cancels stale delete confirmation and does not send a deletion', async () => {
  panel();
  await loaded();
  fireEvent.click(screen.getByRole('button', { name: copy.delete }));
  await screen.findByRole('dialog');
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(mock.remove).not.toHaveBeenCalled();
});
it('navigation suppresses old read results and removes comment content', async () => {
  let resolve: (value: unknown) => void = () => {};
  panel();
  await loaded();
  mock.list.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
  act(() => {
    window.history.replaceState(null, '', '/different');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await act(async () => resolve(ok(initial)));
  expect(
    screen.queryByTestId('community-interactions-content'),
  ).not.toBeInTheDocument();
});
it('interrupted create retains its frozen intent but ignores the old late success', async () => {
  let resolve: (value: unknown) => void = () => {};
  mock.create.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  panel();
  await loaded();
  await start('create');
  const original = mock.create.mock.calls[0]![1];
  act(() => window.dispatchEvent(new Event('focus')));
  await screen.findByTestId('community-interactions-recovery');
  await act(async () =>
    resolve(
      ok({ id: original.comment_id, post_id: original.post_id, revision: 1 }),
    ),
  );
  expect(mock.changed).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: copy.retryOperation }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: copy.retryOperation }));
  await waitFor(() => expect(mock.create).toHaveBeenCalledTimes(2));
  expect(mock.create.mock.calls[1]![1]).toEqual(original);
});
it('temporary parent refresh hides private content without dropping an uncertain operation', async () => {
  mock.create.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  window.history.replaceState(null, '', path);
  const view = render(wrapper(<Harness />));
  await loaded();
  await start('create');
  await screen.findByTestId('community-interactions-recovery');
  const original = mock.create.mock.calls[0]![1];
  view.rerender(wrapper(<Harness snapshot={null} />));
  expect(
    screen.queryByTestId('community-interactions'),
  ).not.toBeInTheDocument();
  view.rerender(wrapper(<Harness snapshot={{ ...boardDetail }} />));
  await screen.findByTestId('community-interactions-recovery');
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: copy.retryOperation }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: copy.retryOperation }));
  await waitFor(() => expect(mock.create).toHaveBeenCalledTimes(2));
  expect(mock.create.mock.calls[1]![1]).toEqual(original);
});
it('a new actor destroys the old draft and recovery instead of replaying its operation', async () => {
  mock.create.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  window.history.replaceState(null, '', path);
  const view = render(wrapper(<Harness />));
  await loaded();
  await start('create');
  await screen.findByTestId('community-interactions-recovery');
  fresh = { ...fresh, actor_id: boardOtherId };
  view.rerender(
    wrapper(
      <Harness
        actor={boardOtherId}
        snapshot={{ ...boardDetail, actor_id: boardOtherId }}
      />,
    ),
  );
  await loaded();
  expect(
    screen.queryByTestId('community-interactions-recovery'),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText(copy.bodyLabel)).toHaveValue('');
  expect(mock.create).toHaveBeenCalledOnce();
  expect(mock.list.mock.calls.at(-1)![2]).toBe(boardOtherId);
});
it('definitive parent denial purges pending input before the same parent later revalidates', async () => {
  mock.create.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  window.history.replaceState(null, '', path);
  const view = render(wrapper(<Harness />));
  await loaded();
  await start('create');
  await screen.findByTestId('community-interactions-recovery');
  view.rerender(wrapper(<Harness snapshot={null} error="FORBIDDEN" />));
  await act(async () => {});
  view.rerender(wrapper(<Harness snapshot={{ ...boardDetail }} />));
  await loaded();
  expect(
    screen.queryByTestId('community-interactions-recovery'),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText(copy.bodyLabel)).toHaveValue('');
  expect(mock.create).toHaveBeenCalledOnce();
});
it('parent integration removes post body and images after interaction target denial', async () => {
  mock.detail.mockResolvedValue(
    ok({
      ...boardDetail,
      post: { ...boardDetail.post, image_count: 1, images: [boardImage] },
    }),
  );
  detail();
  await loaded();
  expect(screen.getByText(boardDetail.post.body)).toBeVisible();
  mock.list.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
  fireEvent.click(screen.getByRole('button', { name: copy.refresh }));
  await screen.findByText(postCopy.errors.NOT_FOUND);
  expect(screen.queryByTestId('community-post-detail')).not.toBeInTheDocument();
  expect(screen.queryByText(boardDetail.post.body)).not.toBeInTheDocument();
  expect(
    screen.queryByTestId('community-interactions'),
  ).not.toBeInTheDocument();
  expect(mock.read).not.toHaveBeenCalled();
});
it('parent integration refreshes its revision after a like before owner deletion', async () => {
  mock.detail
    .mockResolvedValueOnce(ok(boardDetail))
    .mockResolvedValue(
      ok({ ...boardDetail, post: { ...boardDetail.post, revision: 5 } }),
    );
  detail();
  await loaded();
  await start('like');
  await screen.findByRole('button', { name: copy.unlike });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: postCopy.deleteAction }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: postCopy.deleteAction }));
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: postCopy.deleteDialogConfirm,
    }),
  );
  await screen.findByText(postCopy.deleted);
  expect(mock.detail).toHaveBeenCalledTimes(2);
  expect(mock.postDelete.mock.calls[0]![1].expected_revision).toBe(5);
});
it('parent integration keeps pending interaction recovery through its explicit refresh', async () => {
  mock.like.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  detail();
  await loaded();
  await start('like');
  await screen.findByTestId('community-interactions-recovery');
  const original = mock.like.mock.calls[0]![1];
  expect(
    screen.getByRole('button', { name: postCopy.deleteAction }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: postCopy.refresh }));
  await waitFor(() => expect(mock.detail).toHaveBeenCalledTimes(2));
  await screen.findByTestId('community-interactions-recovery');
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: copy.retryOperation }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: copy.retryOperation }));
  await screen.findByRole('button', { name: copy.unlike });
  expect(mock.like.mock.calls[1]![1]).toEqual(original);
});

it('does not re-expose old comments while a changed same-account parent awaits fresh interactions', async () => {
  let resolve: (value: unknown) => void = () => {};
  window.history.replaceState(null, '', path);
  const view = render(wrapper(<Harness />));
  await loaded();
  mock.list.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  view.rerender(wrapper(<Harness snapshot={{ ...boardDetail }} />));
  expect(screen.queryByText(comment.body)).not.toBeInTheDocument();
  await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(comment.body)).not.toBeInTheDocument();
  await act(async () =>
    resolve(ok({ ...initial, comments: [other], comment_count: 1 })),
  );
  expect(await screen.findByText(other.body)).toBeVisible();
  expect(screen.queryByText(comment.body)).not.toBeInTheDocument();
});

it('drops the old edit form when a fresh parent validates but its hidden comment is absent', async () => {
  window.history.replaceState(null, '', path);
  const view = render(wrapper(<Harness />));
  await loaded();
  await edit('비공개 수정 초안');
  fresh = { ...fresh, comments: [other], comment_count: 1 };
  view.rerender(wrapper(<Harness snapshot={{ ...boardDetail }} />));
  expect(
    screen.queryByDisplayValue('비공개 수정 초안'),
  ).not.toBeInTheDocument();
  await screen.findByText(other.body);
  expect(
    screen.queryByTestId('community-comment-editor'),
  ).not.toBeInTheDocument();
  expect(mock.update).not.toHaveBeenCalled();
});
it('cancels delete confirmation when a newly validated parent replaces its snapshot', async () => {
  window.history.replaceState(null, '', path);
  const view = render(wrapper(<Harness />));
  await loaded();
  fireEvent.click(screen.getByRole('button', { name: copy.delete }));
  await screen.findByRole('dialog');
  view.rerender(wrapper(<Harness snapshot={{ ...boardDetail }} />));
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(mock.remove).not.toHaveBeenCalled();
});
it('a hidden document clears rendered comments and prevents mutation until visible revalidation', async () => {
  panel();
  await loaded();
  act(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(screen.queryByText(comment.body)).not.toBeInTheDocument();
  expect(
    screen.queryByTestId('community-comment-create'),
  ).not.toBeInTheDocument();
  expect(mock.create).not.toHaveBeenCalled();
  fresh = { ...fresh, comments: [other], comment_count: 1 };
  act(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await screen.findByText(other.body);
  expect(screen.queryByText(comment.body)).not.toBeInTheDocument();
});
it('new target identity cannot reuse an earlier pending request', async () => {
  mock.like.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  window.history.replaceState(null, '', path);
  const props = {
    slug: boardArtist.slug,
    postId: boardDetail.post.id,
    actorKey: boardActorId,
    path,
    parentSnapshot: boardDetail,
    parentError: null,
    disabled: false,
    onAccessLost: mock.lost,
    onChanged: async () => {},
    onBusyChange: mock.busy,
  };
  const view = render(wrapper(<CommunityInteractions {...props} />));
  await loaded();
  await start('like');
  await screen.findByTestId('community-interactions-recovery');
  const nextPost = 'b5000000-0000-4000-8000-000000000020';
  const nextPath = communityPostPath(boardArtist.slug, nextPost);
  fresh = { ...fresh, post_id: nextPost, comments: [] };
  window.history.replaceState(null, '', nextPath);
  view.rerender(
    wrapper(
      <CommunityInteractions
        {...props}
        postId={nextPost}
        path={nextPath}
        parentSnapshot={{
          ...boardDetail,
          post: { ...boardDetail.post, id: nextPost },
        }}
      />,
    ),
  );
  await screen.findByTestId('community-interactions-content');
  expect(
    screen.queryByTestId('community-interactions-recovery'),
  ).not.toBeInTheDocument();
  expect(mock.like).toHaveBeenCalledOnce();
  expect(mock.list.mock.calls.at(-1)![0].post_id).toBe(nextPost);
});

it('preserves unknown parent deletion after the child discovers its tombstone and retries the exact receipt', async () => {
  mock.list
    .mockResolvedValueOnce(ok(initial))
    .mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
  mock.postDelete
    .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
    .mockResolvedValueOnce(ok({ id: boardDetail.post.id, deleted: true }));
  detail();
  await loaded();
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: postCopy.deleteAction }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: postCopy.deleteAction }));
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: postCopy.deleteDialogConfirm,
    }),
  );
  await screen.findByText(postCopy.errors.NOT_FOUND);
  expect(mock.list).toHaveBeenCalledTimes(2);
  expect(mock.postDelete).toHaveBeenCalledOnce();
  const original = mock.postDelete.mock.calls[0]![1];
  expect(screen.queryByTestId('community-post-detail')).not.toBeInTheDocument();
  expect(screen.queryByText(boardDetail.post.body)).not.toBeInTheDocument();
  expect(
    screen.queryByTestId('community-interactions-content'),
  ).not.toBeInTheDocument();
  const recovery = screen.getByTestId('community-post-recovery');
  fireEvent.click(
    within(recovery).getByRole('button', { name: postCopy.retryOperation }),
  );
  await screen.findByText(postCopy.deleted);
  expect(mock.postDelete).toHaveBeenCalledTimes(2);
  expect(mock.postDelete.mock.calls[1]![1]).toEqual(original);
  expect(mock.postDelete.mock.calls[1]![3]).toBe(boardActorId);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(
    screen.queryByTestId('community-post-recovery'),
  ).not.toBeInTheDocument();
});

it.each(['FORBIDDEN', 'UNAUTHENTICATED'] as const)(
  'child %s removes unknown parent deletion instead of permitting cross-account replay',
  async (code) => {
    mock.list
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValue({ ok: false, code });
    mock.postDelete.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    detail();
    await loaded();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: postCopy.deleteAction }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: postCopy.deleteAction }),
    );
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: postCopy.deleteDialogConfirm,
      }),
    );
    await screen.findByText(postCopy.errors[code]);
    expect(
      screen.queryByTestId('community-post-recovery'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('community-post-detail'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(boardDetail.post.body)).not.toBeInTheDocument();
    expect(mock.postDelete).toHaveBeenCalledOnce();
  },
);
it.each(['FORBIDDEN', 'UNAUTHENTICATED'] as const)(
  'late parent retry completion cannot resurrect recovery after child %s',
  async (code) => {
    let resolveRead: (value: unknown) => void = () => {};
    let resolveDelete: (value: unknown) => void = () => {};
    mock.list.mockResolvedValueOnce(ok(initial)).mockImplementation(
      () =>
        new Promise((done) => {
          resolveRead = done;
        }),
    );
    mock.postDelete
      .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolveDelete = done;
          }),
      );
    detail();
    await loaded();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: postCopy.deleteAction }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: postCopy.deleteAction }),
    );
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: postCopy.deleteDialogConfirm,
      }),
    );
    const recovery = await screen.findByTestId('community-post-recovery');
    await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2));
    const original = mock.postDelete.mock.calls[0]![1];
    fireEvent.click(
      within(recovery).getByRole('button', { name: postCopy.retryOperation }),
    );
    await waitFor(() => expect(mock.postDelete).toHaveBeenCalledTimes(2));
    // Clearing the parent transport error starts a fresh child read. Resolve
    // that current request, not the superseded read aborted by the retry.
    await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(3));
    await act(async () => resolveRead({ ok: false, code }));
    await screen.findByText(postCopy.errors[code]);
    await act(async () =>
      resolveDelete(ok({ id: boardDetail.post.id, deleted: true })),
    );
    expect(
      screen.queryByTestId('community-post-recovery'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(postCopy.deleted)).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('community-post-detail'),
    ).not.toBeInTheDocument();
    expect(mock.postDelete.mock.calls[1]![1]).toEqual(original);
    expect(mock.postDelete.mock.calls[1]![3]).toBe(boardActorId);
  },
);
it('retains the exact unknown notice intent through child policy loss until explicit retry', async () => {
  const adminDetail = { ...boardDetail, can_create_notice: true };
  mock.detail.mockImplementation(async () => ok(structuredClone(adminDetail)));
  mock.list
    .mockResolvedValueOnce(ok(initial))
    .mockResolvedValueOnce({ ok: false, code: 'SETUP_NOT_READY' })
    .mockImplementation(async () => ok(fresh));
  mock.notice
    .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
    .mockResolvedValueOnce(
      ok({
        id: boardDetail.post.id,
        artist_id: boardArtist.id,
        revision: 2,
        is_notice: true,
        is_pinned: false,
      }),
    );
  detail();
  await loaded();
  await waitFor(() =>
    expect(screen.getByLabelText(postCopy.noticeLabel)).toBeEnabled(),
  );
  fireEvent.click(screen.getByLabelText(postCopy.noticeLabel));
  fireEvent.click(screen.getByRole('button', { name: postCopy.saveNotice }));
  await screen.findByText(postCopy.errors.SETUP_NOT_READY);
  expect(screen.queryByTestId('community-post-detail')).not.toBeInTheDocument();
  expect(mock.notice).toHaveBeenCalledOnce();
  const original = mock.notice.mock.calls[0]![1];
  const recovery = screen.getByTestId('community-post-recovery');
  fireEvent.click(
    within(recovery).getByRole('button', { name: postCopy.retryOperation }),
  );
  await screen.findByText(postCopy.noticeSaved);
  expect(mock.notice).toHaveBeenCalledTimes(2);
  expect(mock.notice.mock.calls[1]![1]).toEqual(original);
  expect(mock.notice.mock.calls[1]![3]).toBe(boardActorId);
  expect(
    screen.queryByTestId('community-post-recovery'),
  ).not.toBeInTheDocument();
});

it.each([
  ['delete', 'actor'],
  ['delete', 'target'],
  ['notice', 'actor'],
  ['notice', 'target'],
] as const)(
  'discards pending parent %s intent when mounted %s identity changes',
  async (operation, identity) => {
    let current = { ...boardDetail, can_create_notice: true };
    mock.detail.mockImplementation(async () => ok(structuredClone(current)));
    mock.list.mockImplementation(async () =>
      ok({
        ...initial,
        actor_id: current.actor_id,
        post_id: current.post.id,
        comments: [],
      }),
    );
    const mutate = operation === 'delete' ? mock.postDelete : mock.notice;
    mutate.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    window.history.replaceState(null, '', path);
    const props = {
      slug: boardArtist.slug,
      postId: boardDetail.post.id,
      actorKey: boardActorId,
      path,
    };
    const view = render(wrapper(<CommunityPostDetail {...props} />));
    await loaded();
    if (operation === 'delete') {
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: postCopy.deleteAction }),
        ).toBeEnabled(),
      );
      fireEvent.click(
        screen.getByRole('button', { name: postCopy.deleteAction }),
      );
      fireEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: postCopy.deleteDialogConfirm,
        }),
      );
    } else {
      await waitFor(() =>
        expect(screen.getByLabelText(postCopy.noticeLabel)).toBeEnabled(),
      );
      fireEvent.click(screen.getByLabelText(postCopy.noticeLabel));
      fireEvent.click(
        screen.getByRole('button', { name: postCopy.saveNotice }),
      );
    }
    await screen.findByTestId('community-post-recovery');
    await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2));
    expect(mutate).toHaveBeenCalledOnce();
    const nextActor = identity === 'actor' ? boardOtherId : boardActorId;
    const nextPost =
      identity === 'target'
        ? 'b5000000-0000-4000-8000-000000000021'
        : boardDetail.post.id;
    current = {
      ...current,
      actor_id: nextActor,
      post: { ...current.post, id: nextPost, body: '새로 확인한 글' },
    };
    const nextPath = communityPostPath(boardArtist.slug, nextPost);
    window.history.replaceState(null, '', nextPath);
    view.rerender(
      wrapper(
        <CommunityPostDetail
          {...props}
          actorKey={nextActor}
          postId={nextPost}
          path={nextPath}
        />,
      ),
    );
    await screen.findByText('새로 확인한 글');
    await screen.findByTestId('community-interactions-content');
    expect(
      screen.queryByTestId('community-post-recovery'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(boardDetail.post.body)).not.toBeInTheDocument();
    expect(mutate).toHaveBeenCalledOnce();
    expect(mock.detail.mock.calls.at(-1)![0].post_id).toBe(nextPost);
    expect(mock.detail.mock.calls.at(-1)![2]).toBe(nextActor);
  },
);
