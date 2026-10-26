// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import {
  fetchCommunityInteractions,
  createCommunityComment,
  updateCommunityComment,
  deleteCommunityComment,
  setCommunityLike,
} from '@/client/community-interactions';
import { COMMUNITY_INTERACTIONS } from '@/config/community-interactions';
import {
  COMMUNITY_POSTS,
  COMMUNITY_ERROR_STATUS,
} from '@/config/community-posts';
import {
  communityCommentsPath,
  communityCommentActionPath,
  communityLikePath,
} from '@/config/routes';
import {
  interactionsActorId,
  interactionsPostId,
  interactionsOtherId,
  interactionsSlug,
  interactionsQuery,
  interactionsComment,
  interactionsPage,
  interactionsCreate,
  interactionsUpdate,
  interactionsDelete,
  interactionsLike,
  interactionsCreated,
  interactionsUpdated,
  interactionsDeleted,
  interactionsLiked,
} from './community-interactions-fixtures';
const ok = (data: unknown) => ({ ok: true, data });
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
afterEach(() => vi.unstubAllGlobals());
const writes = [
  [
    'create',
    () =>
      createCommunityComment(
        interactionsSlug,
        interactionsCreate,
        undefined,
        interactionsActorId,
      ),
    interactionsCreate,
    interactionsCreated,
    communityCommentsPath(interactionsSlug, interactionsPostId),
  ],
  [
    'update',
    () =>
      updateCommunityComment(
        interactionsSlug,
        interactionsUpdate,
        undefined,
        interactionsActorId,
      ),
    interactionsUpdate,
    interactionsUpdated,
    communityCommentActionPath(
      interactionsSlug,
      interactionsPostId,
      interactionsComment.id,
      'edit',
    ),
  ],
  [
    'delete',
    () =>
      deleteCommunityComment(
        interactionsSlug,
        interactionsDelete,
        undefined,
        interactionsActorId,
      ),
    interactionsDelete,
    interactionsDeleted,
    communityCommentActionPath(
      interactionsSlug,
      interactionsPostId,
      interactionsComment.id,
      'delete',
    ),
  ],
  [
    'like',
    () =>
      setCommunityLike(
        interactionsSlug,
        interactionsLike,
        undefined,
        interactionsActorId,
      ),
    interactionsLike,
    interactionsLiked,
    communityLikePath(interactionsSlug, interactionsPostId),
  ],
] as const;
it('reads with exact account header and private no-store same-origin nonredirecting transport', async () => {
  const fetcher = vi.fn().mockResolvedValue(response(ok(interactionsPage)));
  vi.stubGlobal('fetch', fetcher);
  expect(
    await fetchCommunityInteractions(
      interactionsQuery,
      undefined,
      interactionsActorId,
    ),
  ).toEqual(ok(interactionsPage));
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    communityCommentsPath(interactionsSlug, interactionsPostId),
    expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { [COMMUNITY_POSTS.actorHeader]: interactionsActorId },
      signal: expect.any(AbortSignal),
    }),
  );
});
it.each(writes)(
  '%s retains exact body/operation on manual retry',
  async (_name, action, input, receipt, path) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(ok(receipt)))
      .mockResolvedValueOnce(response(ok(receipt)));
    vi.stubGlobal('fetch', fetcher);
    expect(await action()).toEqual(ok(receipt));
    expect(await action()).toEqual(ok(receipt));
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe(path);
      expect(JSON.parse(init.body)).toEqual(input);
      expect(init.body).toBe(fetcher.mock.calls[0]![1].body);
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          [COMMUNITY_POSTS.actorHeader]: interactionsActorId,
        },
        body: expect.any(String),
      });
    }
  },
);
it('does not automatically retry an unknown mutation outcome', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('response lost'));
  vi.stubGlobal('fetch', fetcher);
  expect(await writes[0][1]()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(fetcher).toHaveBeenCalledOnce();
});
it.each(Object.entries(COMMUNITY_ERROR_STATUS))(
  'requires matching error code %s and status %d',
  async (code, status) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: false, code }, status))
      .mockResolvedValueOnce(response({ ok: false, code }, 200));
    vi.stubGlobal('fetch', fetcher);
    expect(
      await fetchCommunityInteractions(
        interactionsQuery,
        undefined,
        interactionsActorId,
      ),
    ).toEqual({ ok: false, code });
    expect(
      await fetchCommunityInteractions(
        interactionsQuery,
        undefined,
        interactionsActorId,
      ),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  },
);
it.each([
  () => response(ok(interactionsPage), 201),
  () => response(ok(interactionsPage), 503),
  () => response(ok({ ...interactionsPage, actor_id: interactionsOtherId })),
  () => response(ok({ ...interactionsPage, post_id: interactionsOtherId })),
  () => response(ok({ ...interactionsPage, private: 'hidden' })),
  () => response({ ok: false, code: 'RAW_SQL' }, 500),
  () => response({ ok: false, code: 'FORBIDDEN', private: 'secret' }, 403),
  () =>
    new Response('<html>login</html>', {
      headers: { 'content-type': 'text/html' },
    }),
  () => new Response('{', { headers: { 'content-type': 'application/json' } }),
  () => new Response(null, { headers: { 'content-type': 'application/json' } }),
  () =>
    new Response(new Uint8Array([0xff]), {
      headers: { 'content-type': 'application/json' },
    }),
])('rejects unverified wire response %#', async (factory) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(factory()));
  expect(
    await fetchCommunityInteractions(
      interactionsQuery,
      undefined,
      interactionsActorId,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('rejects absent/invalid mounted actor and an already aborted signal before fetching', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  for (const actor of [undefined, '', 'bad'])
    expect(
      await fetchCommunityInteractions(interactionsQuery, undefined, actor),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
  const controller = new AbortController();
  controller.abort();
  expect(
    await fetchCommunityInteractions(
      interactionsQuery,
      controller.signal,
      interactionsActorId,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(writes)(
  '%s refuses receipt for another post and unknown fields',
  async (_name, action, _input, receipt) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response(ok({ ...receipt, post_id: interactionsOtherId })),
      )
      .mockResolvedValueOnce(
        response(ok({ ...receipt, unexpected: 'private' })),
      );
    vi.stubGlobal('fetch', fetcher);
    expect(await action()).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(await action()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  },
);
it('validates receipt identity, revision and desired like intent independently', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response(ok({ ...interactionsCreated, id: interactionsOtherId })),
    )
    .mockResolvedValueOnce(
      response(ok({ ...interactionsCreated, revision: 2 })),
    )
    .mockResolvedValueOnce(
      response(ok({ ...interactionsUpdated, revision: 3 })),
    )
    .mockResolvedValueOnce(response(ok(interactionsCreated)))
    .mockResolvedValueOnce(
      response(ok({ ...interactionsDeleted, id: interactionsOtherId })),
    )
    .mockResolvedValueOnce(
      response(ok({ ...interactionsLiked, liked: false })),
    );
  vi.stubGlobal('fetch', fetcher);
  expect((await writes[0][1]()).ok).toBe(false);
  expect((await writes[0][1]()).ok).toBe(false);
  expect((await writes[1][1]()).ok).toBe(false);
  expect((await writes[1][1]()).ok).toBe(true);
  expect((await writes[2][1]()).ok).toBe(false);
  expect((await writes[3][1]()).ok).toBe(false);
});
it('encodes cursor and rejects a nonadvancing continuation page', async () => {
  const fetcher = vi.fn().mockResolvedValue(response(ok(interactionsPage)));
  vi.stubGlobal('fetch', fetcher);
  const cursor = {
    created_at: interactionsComment.created_at,
    id: interactionsComment.id,
  };
  expect(
    await fetchCommunityInteractions(
      { ...interactionsQuery, cursor },
      undefined,
      interactionsActorId,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(fetcher.mock.calls[0]![0]).toBe(
    communityCommentsPath(
      interactionsSlug,
      interactionsPostId,
      JSON.stringify(cursor),
    ),
  );
});
it('rejects invalid routes/input before transport', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const outputs = [
    await fetchCommunityInteractions(
      { ...interactionsQuery, slug: 'bad/path' },
      undefined,
      interactionsActorId,
    ),
    await createCommunityComment(
      'bad/path',
      interactionsCreate,
      undefined,
      interactionsActorId,
    ),
    await createCommunityComment(
      interactionsSlug,
      { ...interactionsCreate, body: ' ' },
      undefined,
      interactionsActorId,
    ),
    await updateCommunityComment(
      interactionsSlug,
      { ...interactionsUpdate, expected_revision: 0 },
      undefined,
      interactionsActorId,
    ),
    await deleteCommunityComment(
      interactionsSlug,
      { ...interactionsDelete, confirmed: false } as never,
      undefined,
      interactionsActorId,
    ),
    await setCommunityLike(
      interactionsSlug,
      { ...interactionsLike, liked: null } as never,
      undefined,
      interactionsActorId,
    ),
  ];
  expect(outputs).toEqual(
    outputs.map(() => ({ ok: false, code: 'INVALID_INPUT' })),
  );
  expect(fetcher).not.toHaveBeenCalled();
});
it('caps response bytes and cancels transport before parsing oversized content', async () => {
  const cancel = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new Uint8Array(COMMUNITY_INTERACTIONS.responseMaxBytes + 1),
            );
          },
          cancel,
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
  expect(
    await fetchCommunityInteractions(
      interactionsQuery,
      undefined,
      interactionsActorId,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(cancel).toHaveBeenCalledOnce();
});
it('treats a stream failure as unknown, never fabricated success', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('broken connection'));
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
  expect(await writes[3][1]()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
