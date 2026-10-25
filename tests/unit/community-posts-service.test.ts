// @vitest-environment node
import { expect, it, vi } from 'vitest';
import {
  COMMUNITY_POSTS,
  communityCreateSchema,
  communityDetailSchema,
  communityListSchema,
  communityCursorAfter,
  communityPolicySchema,
} from '@/config/community-posts';
import {
  listCommunityPosts,
  getCommunityPost,
  resolveCommunityListQuery,
} from '@/server/services/community-posts/read';
import {
  createCommunityPost,
  deleteCommunityPost,
  setCommunityNotice,
} from '@/server/services/community-posts/manage';
import {
  boardActorId,
  boardArtist,
  boardArtistId,
  boardPostId,
  boardOtherId,
  boardSummary,
  boardList,
  boardDetail,
  boardCreate,
  boardDelete,
  boardNotice,
  boardCreated,
  boardDeleted,
  boardNoticeReceipt,
  boardImage,
  boardPolicy,
} from './community-posts-fixtures';
const listQuery = { slug: boardArtist.slug, cursor: null };
const detailQuery = { slug: boardArtist.slug, post_id: boardPostId };
function port() {
  return {
    list: vi.fn().mockResolvedValue({ ok: true, data: boardList }),
    detail: vi.fn().mockResolvedValue({ ok: true, data: boardDetail }),
    create: vi.fn().mockResolvedValue({ ok: true, data: boardCreated }),
    delete: vi.fn().mockResolvedValue({ ok: true, data: boardDeleted }),
    notice: vi.fn().mockResolvedValue({ ok: true, data: boardNoticeReceipt }),
  };
}
it('reads only a current-account board snapshot and exact route detail', async () => {
  const p = port();
  expect(await listCommunityPosts(p, listQuery, boardActorId)).toEqual({
    ok: true,
    data: boardList,
  });
  expect(p.list).toHaveBeenCalledExactlyOnceWith(listQuery);
  expect(await getCommunityPost(p, detailQuery, boardActorId)).toEqual({
    ok: true,
    data: boardDetail,
  });
  expect(p.detail).toHaveBeenCalledExactlyOnceWith(detailQuery);
});
it('resolves only a strict bounded cursor JSON query', () => {
  expect(resolveCommunityListQuery({ slug: boardArtist.slug })).toEqual({
    ok: true,
    data: listQuery,
  });
  const cursor = {
    is_pinned: false,
    created_at: boardSummary.created_at,
    id: boardPostId,
  };
  expect(
    resolveCommunityListQuery({
      slug: boardArtist.slug,
      cursor: JSON.stringify(cursor),
    }),
  ).toEqual({ ok: true, data: { ...listQuery, cursor } });
});
it.each([
  null,
  {},
  { slug: 'bad slug' },
  { slug: boardArtist.slug, cursor: '' },
  { slug: boardArtist.slug, cursor: '{' },
  { slug: boardArtist.slug, cursor: '{}' },
  { slug: boardArtist.slug, cursor: 'x'.repeat(COMMUNITY_POSTS.cursorMax + 1) },
  { slug: boardArtist.slug, artist_id: boardArtistId },
])('rejects malformed raw query %#', (input) =>
  expect(resolveCommunityListQuery(input)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  }),
);
it.each([
  null,
  {},
  { slug: boardArtist.slug },
  { ...listQuery, cursor: {} },
  { ...listQuery, actor_id: boardOtherId },
])('rejects invalid list before port %#', async (input) => {
  const p = port();
  expect(await listCommunityPosts(p, input, boardActorId)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(p.list).not.toHaveBeenCalled();
});
it.each([
  null,
  {},
  { ...detailQuery, post_id: 'bad' },
  { ...detailQuery, slug: '../' },
  { ...detailQuery, actor_id: boardActorId },
])('rejects invalid detail before port %#', async (input) => {
  const p = port();
  expect(await getCommunityPost(p, input, boardActorId)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(p.detail).not.toHaveBeenCalled();
});
it('rejects an invalid account key rather than weakening binding', async () => {
  const p = port();
  expect((await listCommunityPosts(p, listQuery, 'bad')).ok).toBe(false);
  expect((await getCommunityPost(p, detailQuery, '')).ok).toBe(false);
  expect(p.list).not.toHaveBeenCalled();
  expect(p.detail).not.toHaveBeenCalled();
});
it.each([
  { ...boardList, actor_id: boardOtherId },
  { ...boardList, artist: { ...boardArtist, slug: 'other' } },
  { ...boardList, posts: [{ ...boardSummary, artist_id: boardOtherId }] },
  { ...boardList, posts: [boardSummary, boardSummary] },
  { ...boardList, posts: [{ ...boardSummary, is_pinned: true }] },
  { ...boardList, storage_path: 'private' },
  { ...boardList, posts: [{ ...boardSummary, user_id: boardActorId }] },
  { ...boardList, policy: null },
])('fails closed on malformed or mismatched list snapshot %#', async (data) => {
  const p = port();
  p.list.mockResolvedValue({ ok: true, data });
  expect(await listCommunityPosts(p, listQuery, boardActorId)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it.each([
  { ...boardDetail, actor_id: boardOtherId },
  { ...boardDetail, artist: { ...boardArtist, slug: 'other' } },
  { ...boardDetail, post: { ...boardDetail.post, id: boardOtherId } },
  { ...boardDetail, post: { ...boardDetail.post, artist_id: boardOtherId } },
  { ...boardDetail, post: { ...boardDetail.post, image_count: 1 } },
  {
    ...boardDetail,
    post: {
      ...boardDetail.post,
      images: [boardImage, boardImage],
      image_count: 2,
    },
  },
  {
    ...boardDetail,
    post: {
      ...boardDetail.post,
      images: [{ ...boardImage, object_path: 'private' }],
      image_count: 1,
    },
  },
])('fails closed on malformed or mismatched detail %#', async (data) => {
  const p = port();
  p.detail.mockResolvedValue({ ok: true, data });
  expect(await getCommunityPost(p, detailQuery, boardActorId)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('accepts literal content, nullable display name and legacy whitespace without retroactive rewrites', () => {
  const value = {
    ...boardDetail,
    post: {
      ...boardDetail.post,
      title: '\u00a0',
      body: ' <script>literal</script>\n{이름}',
      author: { call_name: null },
      images: [boardImage],
      image_count: 1,
    },
  };
  expect(communityDetailSchema.parse(value)).toEqual(value);
  expect(
    communityCreateSchema.safeParse({ ...boardCreate, title: '\u00a0' })
      .success,
  ).toBe(false);
});
it('orders pinned first and respects microseconds, timestamp offsets and UUID ties', () => {
  const cursor = {
    is_pinned: false,
    created_at: '2026-10-25T10:00:00.000002Z',
    id: boardPostId,
  };
  expect(
    communityCursorAfter(
      { ...cursor, created_at: '2026-10-25T10:00:00.000001Z' },
      cursor,
    ),
  ).toBe(true);
  expect(
    communityCursorAfter(
      { ...cursor, created_at: '2026-10-25T11:00:00.000001+01:00' },
      cursor,
    ),
  ).toBe(true);
  expect(
    communityCursorAfter(
      { ...cursor, created_at: '2026-10-25T10:00:00.000003Z' },
      cursor,
    ),
  ).toBe(false);
  expect(communityCursorAfter({ ...cursor, is_pinned: true }, cursor)).toBe(
    false,
  );
  expect(communityCursorAfter(cursor, { ...cursor, is_pinned: true })).toBe(
    true,
  );
  expect(communityCursorAfter({ ...cursor, id: boardArtistId }, cursor)).toBe(
    true,
  );
  expect(communityCursorAfter(cursor, cursor)).toBe(false);
});
it('validates next cursor against exactly the last full-page row and stable order', () => {
  const posts = Array.from({ length: COMMUNITY_POSTS.pageSize }, (_, i) => ({
    ...boardSummary,
    id: `b4000000-0000-4000-8000-${String(100 - i).padStart(12, '0')}`,
  }));
  const last = posts.at(-1)!;
  const cursor = {
    id: last.id,
    created_at: last.created_at,
    is_pinned: last.is_pinned,
  };
  expect(
    communityListSchema.safeParse({ ...boardList, posts, next_cursor: cursor })
      .success,
  ).toBe(true);
  for (const value of [
    { ...boardList, posts, next_cursor: { ...cursor, id: boardOtherId } },
    { ...boardList, posts: posts.toReversed(), next_cursor: null },
    { ...boardList, posts: posts.slice(1), next_cursor: cursor },
  ])
    expect(communityListSchema.safeParse(value).success).toBe(false);
});
it('continuation pages must lie strictly beyond original pinned/date/id boundary', async () => {
  const p = port();
  const cursor = {
    is_pinned: false,
    created_at: boardSummary.created_at,
    id: boardOtherId,
  };
  expect(
    (await listCommunityPosts(p, { ...listQuery, cursor }, boardActorId)).ok,
  ).toBe(true);
  expect(
    (
      await listCommunityPosts(
        p,
        { ...listQuery, cursor: { ...cursor, id: boardPostId } },
        boardActorId,
      )
    ).ok,
  ).toBe(false);
});
it('saves exact literal body, draft identity, upload order and operation ID', async () => {
  const p = port();
  expect(await createCommunityPost(p, boardArtist.slug, boardCreate)).toEqual({
    ok: true,
    data: boardCreated,
  });
  expect(p.create).toHaveBeenCalledExactlyOnceWith(
    boardArtist.slug,
    boardCreate,
  );
});
it.each([
  null,
  {},
  { ...boardCreate, post_id: 'bad' },
  { ...boardCreate, title: '' },
  { ...boardCreate, body: ' \n' },
  { ...boardCreate, title: 'control\u0000' },
  { ...boardCreate, body: 'bad\ud800' },
  { ...boardCreate, is_pinned: true },
  { ...boardCreate, upload_ids: [boardPostId, boardPostId] },
  { ...boardCreate, user_id: boardActorId },
])('rejects malformed creation before port %#', async (input) => {
  const p = port();
  expect(await createCommunityPost(p, boardArtist.slug, input)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(p.create).not.toHaveBeenCalled();
});
it('enforces Unicode codepoints not UTF16 and preserves intentional authored whitespace', () => {
  const title = '🌟'.repeat(COMMUNITY_POSTS.titleMax);
  expect(
    communityCreateSchema.safeParse({ ...boardCreate, title }).success,
  ).toBe(true);
  expect(
    communityCreateSchema.safeParse({ ...boardCreate, title: title + 'x' })
      .success,
  ).toBe(false);
  expect(
    communityCreateSchema.parse({
      ...boardCreate,
      title: '  hi  ',
      body: '\nline\r\n\tsecond',
    }),
  ).toMatchObject({ title: '  hi  ', body: '\nline\r\n\tsecond' });
});
it.each([
  null,
  { ...boardCreated, id: boardOtherId },
  { ...boardCreated, artist_id: boardOtherId },
  { ...boardCreated, revision: 2 },
  { ...boardCreated, body: 'private' },
])('rejects wrong create receipt %#', async (data) => {
  const p = port();
  p.create.mockResolvedValue({ ok: true, data });
  expect(await createCommunityPost(p, boardArtist.slug, boardCreate)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('confirmed owner deletion and admin pin preserve operation identity', async () => {
  const p = port();
  expect(await deleteCommunityPost(p, boardArtist.slug, boardDelete)).toEqual({
    ok: true,
    data: boardDeleted,
  });
  expect(p.delete).toHaveBeenCalledExactlyOnceWith(
    boardArtist.slug,
    boardDelete,
  );
  expect(await setCommunityNotice(p, boardArtist.slug, boardNotice)).toEqual({
    ok: true,
    data: boardNoticeReceipt,
  });
  expect(p.notice).toHaveBeenCalledExactlyOnceWith(
    boardArtist.slug,
    boardNotice,
  );
});
it.each([
  null,
  {},
  { ...boardDelete, confirmed: false },
  { ...boardDelete, expected_revision: 0 },
  { ...boardDelete, expected_revision: Number.MAX_SAFE_INTEGER + 1 },
  { ...boardDelete, actor_id: boardActorId },
])('rejects invalid delete %#', async (input) => {
  const p = port();
  expect(await deleteCommunityPost(p, boardArtist.slug, input)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(p.delete).not.toHaveBeenCalled();
});
it.each([
  null,
  { ...boardDeleted, id: boardOtherId },
  { ...boardDeleted, deleted: false },
  { ...boardDeleted, extra: true },
])('rejects wrong delete receipt %#', async (data) => {
  const p = port();
  p.delete.mockResolvedValue({ ok: true, data });
  expect(await deleteCommunityPost(p, boardArtist.slug, boardDelete)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it.each([
  null,
  {},
  { ...boardNotice, is_notice: false },
  { ...boardNotice, expected_revision: 0 },
  { ...boardNotice, expected_revision: Number.MAX_SAFE_INTEGER },
  { ...boardNotice, actor_id: boardActorId },
])('rejects invalid notice %#', async (input) => {
  const p = port();
  expect(await setCommunityNotice(p, boardArtist.slug, input)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(p.notice).not.toHaveBeenCalled();
});
it.each([
  null,
  { ...boardNoticeReceipt, id: boardOtherId },
  { ...boardNoticeReceipt, is_notice: false, is_pinned: false },
  { ...boardNoticeReceipt, is_pinned: false },
  { ...boardNoticeReceipt, revision: 3 },
  { ...boardNoticeReceipt, reason: 'secret' },
])('rejects wrong notice receipt %#', async (data) => {
  const p = port();
  p.notice.mockResolvedValue({ ok: true, data });
  expect(await setCommunityNotice(p, boardArtist.slug, boardNotice)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('permits notice no-op revision receipt and maximum-safe read/delete revision', async () => {
  const p = port();
  p.notice.mockResolvedValue({
    ok: true,
    data: { ...boardNoticeReceipt, revision: 1 },
  });
  expect((await setCommunityNotice(p, boardArtist.slug, boardNotice)).ok).toBe(
    true,
  );
  expect(
    (
      await deleteCommunityPost(p, boardArtist.slug, {
        ...boardDelete,
        expected_revision: Number.MAX_SAFE_INTEGER,
      })
    ).ok,
  ).toBe(true);
});
it.each([
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'CONTENT_BLOCKED',
  'RATE_LIMITED',
  'SETUP_NOT_READY',
  'UNAVAILABLE',
])(
  'preserves explicit %s failures without fabricated success',
  async (code) => {
    const p = port();
    Object.values(p).forEach((fn) => fn.mockResolvedValue({ ok: false, code }));
    for (const result of await Promise.all([
      listCommunityPosts(p, listQuery, boardActorId),
      getCommunityPost(p, detailQuery, boardActorId),
      createCommunityPost(p, boardArtist.slug, boardCreate),
      deleteCommunityPost(p, boardArtist.slug, boardDelete),
      setCommunityNotice(p, boardArtist.slug, boardNotice),
    ]))
      expect(result).toEqual({ ok: false, code });
  },
);
it('contains thrown provider/DB diagnostics and accepts no invalid mutation slug', async () => {
  const p = port();
  Object.values(p).forEach((fn) =>
    fn.mockRejectedValue(new Error('private SQL')),
  );
  for (const result of await Promise.all([
    listCommunityPosts(p, listQuery, boardActorId),
    getCommunityPost(p, detailQuery, boardActorId),
    createCommunityPost(p, boardArtist.slug, boardCreate),
    deleteCommunityPost(p, boardArtist.slug, boardDelete),
    setCommunityNotice(p, boardArtist.slug, boardNotice),
  ]))
    expect(result).toEqual({ ok: false, code: 'UNAVAILABLE' });
  for (const result of await Promise.all([
    createCommunityPost(p, '../', boardCreate),
    deleteCommunityPost(p, '../', boardDelete),
    setCommunityNotice(p, '../', boardNotice),
  ]))
    expect(result).toEqual({ ok: false, code: 'INVALID_INPUT' });
});
it.each([
  'max_title_length',
  'max_body_length',
  'max_image_bytes',
  'max_image_long_edge',
])('policy requires configured positive %s', (key) =>
  expect(
    communityPolicySchema.safeParse({ ...boardPolicy, [key]: 0 }).success,
  ).toBe(false),
);
it('permits explicit zero images without inventing a default quota', () => {
  expect(
    communityPolicySchema.parse({ ...boardPolicy, max_images: 0 }).max_images,
  ).toBe(0);
  expect(
    communityPolicySchema.safeParse({ ...boardPolicy, max_images: undefined })
      .success,
  ).toBe(false);
});

it.each(['2026-10-25T10:00:00.0000001Z', '0000-10-25T10:00:00Z'])(
  'rejects cursor timestamp not losslessly representable by the SQL contract %s',
  (created_at) => {
    expect(
      resolveCommunityListQuery({
        slug: boardArtist.slug,
        cursor: JSON.stringify({
          id: boardPostId,
          is_pinned: false,
          created_at,
        }),
      }),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  },
);
