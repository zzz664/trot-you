// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import {
  fetchCommunityPosts,
  fetchCommunityPost,
  createCommunityPost,
  deleteCommunityPost,
  setCommunityNotice,
} from '@/client/community-posts';
import {
  COMMUNITY_POSTS,
  COMMUNITY_ERROR_STATUS,
} from '@/config/community-posts';
import {
  communityBoardPath,
  communityPostPath,
  communityPostActionPath,
} from '@/config/routes';
import {
  boardActorId,
  boardOtherId,
  boardList,
  boardDetail,
  boardCreate,
  boardDelete,
  boardNotice,
  boardCreated,
  boardDeleted,
  boardNoticeReceipt,
} from './community-posts-fixtures';
const ok = (data: unknown) => ({ ok: true, data });
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
afterEach(() => vi.unstubAllGlobals());
it('uses exact account, no-store, same-origin and no-redirect for list and detail', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(ok(boardList)))
    .mockResolvedValueOnce(response(ok(boardDetail)));
  vi.stubGlobal('fetch', fetcher);
  expect(
    await fetchCommunityPosts(
      { slug: boardList.artist.slug, cursor: null },
      undefined,
      boardActorId,
    ),
  ).toEqual(ok(boardList));
  expect(
    await fetchCommunityPost(
      { slug: boardList.artist.slug, post_id: boardDetail.post.id },
      undefined,
      boardActorId,
    ),
  ).toEqual(ok(boardDetail));
  expect(fetcher).toHaveBeenNthCalledWith(
    1,
    communityBoardPath(boardList.artist.slug, null, true),
    expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { [COMMUNITY_POSTS.actorHeader]: boardActorId },
    }),
  );
  expect(fetcher.mock.calls[1]?.[0]).toBe(
    communityPostPath(boardList.artist.slug, boardDetail.post.id, true),
  );
});
it('sends immutable create, delete and notice payloads once without automatic retries', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(ok(boardCreated)))
    .mockResolvedValueOnce(response(ok(boardDeleted)))
    .mockResolvedValueOnce(response(ok(boardNoticeReceipt)))
    .mockRejectedValueOnce(Error('private'));
  vi.stubGlobal('fetch', fetcher);
  expect(
    (
      await createCommunityPost(
        boardList.artist.slug,
        boardCreate,
        undefined,
        boardActorId,
      )
    ).ok,
  ).toBe(true);
  expect(
    (
      await deleteCommunityPost(
        boardList.artist.slug,
        boardDelete,
        undefined,
        boardActorId,
      )
    ).ok,
  ).toBe(true);
  expect(
    (
      await setCommunityNotice(
        boardList.artist.slug,
        boardNotice,
        undefined,
        boardActorId,
      )
    ).ok,
  ).toBe(true);
  expect(
    await createCommunityPost(
      boardList.artist.slug,
      boardCreate,
      undefined,
      boardActorId,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(fetcher).toHaveBeenNthCalledWith(
    2,
    communityPostActionPath(
      boardList.artist.slug,
      boardDelete.post_id,
      'delete',
    ),
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(boardDelete),
    }),
  );
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it.each(Object.entries(COMMUNITY_ERROR_STATUS))(
  'accepts status-bound safe error %s',
  async (code, status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ ok: false, code }, status)),
    );
    expect(
      await fetchCommunityPosts(
        { slug: boardList.artist.slug, cursor: null },
        undefined,
        boardActorId,
      ),
    ).toEqual({ ok: false, code });
  },
);
it.each([
  () => response(ok({ ...boardList, actor_id: boardOtherId })),
  () =>
    response(
      ok({ ...boardList, artist: { ...boardList.artist, slug: 'other' } }),
    ),
  () => response(ok({ ...boardList, secret: 'hidden' })),
  () => response(ok(boardList), 201),
  () => response({ ok: false, code: 'FORBIDDEN' }, 500),
  () => response({ ok: false, code: 'DATABASE_PRIVATE' }, 400),
  () =>
    new Response('not json', {
      headers: { 'content-type': 'application/json' },
    }),
  () => new Response('{}', { headers: { 'content-type': 'text/html' } }),
  () => new Response(null, { headers: { 'content-type': 'application/json' } }),
  () =>
    new Response(new Uint8Array([255]), {
      headers: { 'content-type': 'application/json' },
    }),
])('rejects mismatched, malformed or private response %#', async (factory) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(factory()));
  expect(
    await fetchCommunityPosts(
      { slug: boardList.artist.slug, cursor: null },
      undefined,
      boardActorId,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('rejects missing/invalid mounted actors and canceled signals without transport', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  for (const actor of [undefined, '', 'bad'])
    expect(
      await fetchCommunityPosts(
        { slug: boardList.artist.slug, cursor: null },
        undefined,
        actor,
      ),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
  const controller = new AbortController();
  controller.abort();
  expect(
    await fetchCommunityPosts(
      { slug: boardList.artist.slug, cursor: null },
      controller.signal,
      boardActorId,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('binds read identity, all receipt IDs, create revision and notice flags', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response(
        ok({ ...boardDetail, post: { ...boardDetail.post, id: boardOtherId } }),
      ),
    )
    .mockResolvedValueOnce(response(ok({ ...boardCreated, id: boardOtherId })))
    .mockResolvedValueOnce(response(ok({ ...boardCreated, revision: 2 })))
    .mockResolvedValueOnce(response(ok({ ...boardDeleted, id: boardOtherId })))
    .mockResolvedValueOnce(
      response(ok({ ...boardNoticeReceipt, is_pinned: false })),
    )
    .mockResolvedValueOnce(
      response(ok({ ...boardNoticeReceipt, revision: 4 })),
    );
  vi.stubGlobal('fetch', fetcher);
  const outputs = [
    await fetchCommunityPost(
      { slug: boardList.artist.slug, post_id: boardDetail.post.id },
      undefined,
      boardActorId,
    ),
    await createCommunityPost(
      boardList.artist.slug,
      boardCreate,
      undefined,
      boardActorId,
    ),
    await createCommunityPost(
      boardList.artist.slug,
      boardCreate,
      undefined,
      boardActorId,
    ),
    await deleteCommunityPost(
      boardList.artist.slug,
      boardDelete,
      undefined,
      boardActorId,
    ),
    await setCommunityNotice(
      boardList.artist.slug,
      boardNotice,
      undefined,
      boardActorId,
    ),
    await setCommunityNotice(
      boardList.artist.slug,
      boardNotice,
      undefined,
      boardActorId,
    ),
  ];
  expect(outputs).toEqual(
    outputs.map(() => ({ ok: false, code: 'UNAVAILABLE' })),
  );
});
it('validates cursor boundary in returned rows', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(ok(boardList))));
  const first = boardList.posts[0]!;
  expect(
    await fetchCommunityPosts(
      {
        slug: boardList.artist.slug,
        cursor: {
          id: first.id,
          created_at: first.created_at,
          is_pinned: first.is_pinned,
        },
      },
      undefined,
      boardActorId,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('rejects malformed writes and routes before fetch', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect(
    await createCommunityPost('bad/path', boardCreate, undefined, boardActorId),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(
    await deleteCommunityPost(
      boardList.artist.slug,
      { ...boardDelete, confirmed: false } as never,
      undefined,
      boardActorId,
    ),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(
    await setCommunityNotice(
      boardList.artist.slug,
      { ...boardNotice, is_notice: false },
      undefined,
      boardActorId,
    ),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('caps response bytes and cancels the stream', async () => {
  const cancel = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new Uint8Array(COMMUNITY_POSTS.responseMaxBytes + 1),
            );
          },
          cancel,
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
  expect(
    await fetchCommunityPosts(
      { slug: boardList.artist.slug, cursor: null },
      undefined,
      boardActorId,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(cancel).toHaveBeenCalledOnce();
});
