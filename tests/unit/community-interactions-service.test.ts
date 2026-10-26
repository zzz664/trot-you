// @vitest-environment node
import { expect, it, vi } from 'vitest';
import {
  COMMUNITY_INTERACTIONS,
  communityCommentAfter,
  communityInteractionsSchema,
  communityCommentCreateSchema,
  communityCommentUpdateSchema,
  communityCommentDeleteSchema,
} from '@/config/community-interactions';
import { COMMUNITY_POSTS } from '@/config/community-posts';
import {
  listCommunityInteractions,
  resolveCommunityInteractionsQuery,
} from '@/server/services/community-interactions/read';
import {
  createCommunityComment,
  updateCommunityComment,
  deleteCommunityComment,
  setCommunityLike,
} from '@/server/services/community-interactions/manage';
import {
  interactionsActorId,
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
function port() {
  return {
    list: vi.fn().mockResolvedValue(ok(interactionsPage)),
    create: vi.fn().mockResolvedValue(ok(interactionsCreated)),
    update: vi.fn().mockResolvedValue(ok(interactionsUpdated)),
    delete: vi.fn().mockResolvedValue(ok(interactionsDeleted)),
    like: vi.fn().mockResolvedValue(ok(interactionsLiked)),
  };
}
const methods = [
  ['create', createCommunityComment, interactionsCreate, interactionsCreated],
  ['update', updateCommunityComment, interactionsUpdate, interactionsUpdated],
  ['delete', deleteCommunityComment, interactionsDelete, interactionsDeleted],
  ['like', setCommunityLike, interactionsLike, interactionsLiked],
] as const;
it('returns a fresh actor/post bound ordered interaction snapshot', async () => {
  const p = port();
  expect(
    await listCommunityInteractions(p, interactionsQuery, interactionsActorId),
  ).toEqual(ok(interactionsPage));
  expect(p.list).toHaveBeenCalledExactlyOnceWith(interactionsQuery);
});
it('resolves a bounded optional ascending cursor without normalization', () => {
  const input = { slug: interactionsSlug, post_id: interactionsQuery.post_id };
  expect(resolveCommunityInteractionsQuery(input)).toEqual(
    ok(interactionsQuery),
  );
  const cursor = {
    created_at: interactionsComment.created_at,
    id: interactionsComment.id,
  };
  expect(
    resolveCommunityInteractionsQuery({
      ...input,
      cursor: JSON.stringify(cursor),
    }),
  ).toEqual(ok({ ...interactionsQuery, cursor }));
});
it.each([
  null,
  {},
  { slug: 'bad slug' },
  { ...interactionsQuery, cursor: '' },
  { ...interactionsQuery, cursor: '{' },
  { ...interactionsQuery, cursor: '{}' },
  { ...interactionsQuery, cursor: 'x'.repeat(COMMUNITY_POSTS.cursorMax + 1) },
  { ...interactionsQuery, cursor: undefined, actor_id: interactionsActorId },
])('rejects malformed raw query %#', (input) =>
  expect(resolveCommunityInteractionsQuery(input)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  }),
);
it.each([
  null,
  {},
  { ...interactionsQuery, post_id: 'bad' },
  { ...interactionsQuery, slug: '../' },
  { ...interactionsQuery, cursor: {} },
  { ...interactionsQuery, actor_id: interactionsActorId },
])('rejects invalid list input without IO %#', async (input) => {
  const p = port();
  expect(
    await listCommunityInteractions(p, input, interactionsActorId),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(p.list).not.toHaveBeenCalled();
});
it.each(['', 'invalid'])(
  'rejects invalid actor key %s without IO',
  async (actor) => {
    const p = port();
    expect(
      await listCommunityInteractions(p, interactionsQuery, actor),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(p.list).not.toHaveBeenCalled();
  },
);
it.each([
  null,
  {},
  [],
  { ...interactionsPage, actor_id: interactionsOtherId },
  { ...interactionsPage, post_id: interactionsOtherId },
  { ...interactionsPage, secret: 'private' },
  {
    ...interactionsPage,
    comments: [{ ...interactionsComment, user_id: interactionsActorId }],
  },
  {
    ...interactionsPage,
    comments: [{ ...interactionsComment, post_id: interactionsOtherId }],
  },
  {
    ...interactionsPage,
    comments: [interactionsComment, interactionsComment],
    comment_count: 2,
  },
  {
    ...interactionsPage,
    comments: [
      { ...interactionsComment, author: { call_name: '팬', email: 'private' } },
    ],
  },
  { ...interactionsPage, comment_count: 0 },
  { ...interactionsPage, like_count: -1 },
  { ...interactionsPage, liked: true },
  { ...interactionsPage, policy: {} },
  { ...interactionsPage, policy: { max_comment_length: 0 } },
  {
    ...interactionsPage,
    policy: { max_comment_length: COMMUNITY_INTERACTIONS.bodyMax + 1 },
  },
  {
    ...interactionsPage,
    next_cursor: {
      id: interactionsComment.id,
      created_at: interactionsComment.created_at,
    },
  },
])(
  'fails closed on mismatched/malformed/private snapshots %#',
  async (data) => {
    const p = port();
    p.list.mockResolvedValue(ok(data));
    expect(
      await listCommunityInteractions(
        p,
        interactionsQuery,
        interactionsActorId,
      ),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  },
);
it('orders timestamps at PostgreSQL microsecond precision and then UUID', () => {
  const a = {
    created_at: '2026-10-25T10:00:00.000001Z',
    id: interactionsComment.id,
  };
  const b = { ...a, created_at: '2026-10-25T10:00:00.000002Z' };
  expect(communityCommentAfter(b, a)).toBe(true);
  expect(communityCommentAfter(a, b)).toBe(false);
  expect(communityCommentAfter(a, a)).toBe(false);
  expect(communityCommentAfter({ ...a, id: interactionsOtherId }, a)).toBe(
    true,
  );
  expect(
    communityCommentAfter(
      { ...a, created_at: '2026-10-25T19:00:00.000001+09:00' },
      a,
    ),
  ).toBe(false);
});
it('validates deterministic ascending order and matching full-page cursor', () => {
  const comments = Array.from(
    { length: COMMUNITY_INTERACTIONS.pageSize },
    (_, index) => ({
      ...interactionsComment,
      id: `c5000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    }),
  );
  const last = comments.at(-1)!;
  const page = {
    ...interactionsPage,
    comments,
    comment_count: comments.length + 1,
    next_cursor: { id: last.id, created_at: last.created_at },
  };
  expect(communityInteractionsSchema.safeParse(page).success).toBe(true);
  expect(
    communityInteractionsSchema.safeParse({
      ...page,
      comments: [...comments].reverse(),
    }).success,
  ).toBe(false);
  expect(
    communityInteractionsSchema.safeParse({
      ...page,
      next_cursor: { ...page.next_cursor, id: interactionsOtherId },
    }).success,
  ).toBe(false);
  expect(
    communityInteractionsSchema.safeParse({
      ...page,
      comments: [...comments, last],
    }).success,
  ).toBe(false);
});
it('checks returned continuation rows strictly after requested cursor', async () => {
  const p = port(),
    cursor = {
      created_at: interactionsComment.created_at,
      id: interactionsComment.id,
    };
  expect(
    await listCommunityInteractions(
      p,
      { ...interactionsQuery, cursor },
      interactionsActorId,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  p.list.mockResolvedValue(
    ok({
      ...interactionsPage,
      comments: [{ ...interactionsComment, id: interactionsOtherId }],
    }),
  );
  expect(
    (
      await listCommunityInteractions(
        p,
        { ...interactionsQuery, cursor },
        interactionsActorId,
      )
    ).ok,
  ).toBe(true);
});
it('does not impose current policy length on previously valid visible comments', () => {
  expect(
    communityInteractionsSchema.safeParse({
      ...interactionsPage,
      policy: { max_comment_length: 1 },
    }).success,
  ).toBe(true);
});
it.each([
  '',
  '  \n\t ',
  '\0',
  'bad\u0001',
  '\ud800',
  '😀'.repeat(COMMUNITY_INTERACTIONS.bodyMax + 1),
])('rejects malformed authored body %#', (body) => {
  expect(
    communityCommentCreateSchema.safeParse({ ...interactionsCreate, body })
      .success,
  ).toBe(false);
  expect(
    communityCommentUpdateSchema.safeParse({ ...interactionsUpdate, body })
      .success,
  ).toBe(false);
});
it('preserves exact whitespace and counts Unicode codepoints', () => {
  const body = ` ${'😀'.repeat(COMMUNITY_INTERACTIONS.bodyMax - 2)} `;
  expect(
    communityCommentCreateSchema.parse({ ...interactionsCreate, body }).body,
  ).toBe(body);
});
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER, Infinity])(
  'rejects unrepresentable mutable revision %s',
  (expected_revision) => {
    expect(
      communityCommentUpdateSchema.safeParse({
        ...interactionsUpdate,
        expected_revision,
      }).success,
    ).toBe(false);
    expect(
      communityCommentDeleteSchema.safeParse({
        ...interactionsDelete,
        expected_revision,
      }).success,
    ).toBe(false);
  },
);
it.each(methods)(
  '%s sends exact parsed operation without adding an actor override',
  async (name, action, input, receipt) => {
    const p = port();
    expect(await action(p, interactionsSlug, input)).toEqual(ok(receipt));
    expect(p[name]).toHaveBeenCalledExactlyOnceWith(interactionsSlug, input);
  },
);
it.each(methods)(
  '%s validates slug and strict input before IO',
  async (name, action, input) => {
    const p = port();
    for (const [slug, body] of [
      ['bad/path', input],
      [interactionsSlug, null],
      [interactionsSlug, { ...input, actor_id: interactionsOtherId }],
      [interactionsSlug, { ...input, operation_id: 'invalid' }],
      [interactionsSlug, { ...input, post_id: 'invalid' }],
    ])
      expect(await action(p, slug, body)).toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
    expect(p[name]).not.toHaveBeenCalled();
  },
);
it.each(methods)(
  '%s rejects malformed or mismatched receipt',
  async (name, action, input, receipt) => {
    const p = port();
    for (const data of [
      null,
      {},
      { ...receipt, post_id: interactionsOtherId },
      { ...receipt, secret: 'private' },
    ]) {
      p[name].mockResolvedValue(ok(data));
      expect(await action(p, interactionsSlug, input)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    }
  },
);
it.each(methods)(
  '%s preserves sanitized DB failure and catches exceptions',
  async (name, action, input) => {
    const p = port();
    p[name].mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
    expect(await action(p, interactionsSlug, input)).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    p[name].mockRejectedValue(new Error('private SQL'));
    expect(await action(p, interactionsSlug, input)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  },
);
it('rejects wrong comment IDs/create revision, accepts no-op edit and rejects unexpected revision', async () => {
  const p = port();
  p.create.mockResolvedValue(ok({ ...interactionsCreated, revision: 2 }));
  expect(
    (await createCommunityComment(p, interactionsSlug, interactionsCreate)).ok,
  ).toBe(false);
  for (const name of ['create', 'update', 'delete'] as const)
    p[name].mockResolvedValue(
      ok({ ...interactionsCreated, id: interactionsOtherId, deleted: true }),
    );
  for (const [, action, input] of methods.slice(0, 3))
    expect((await action(p, interactionsSlug, input)).ok).toBe(false);
  p.update.mockResolvedValue(ok(interactionsCreated));
  expect(
    (await updateCommunityComment(p, interactionsSlug, interactionsUpdate)).ok,
  ).toBe(true);
  p.update.mockResolvedValue(ok({ ...interactionsUpdated, revision: 3 }));
  expect(
    (await updateCommunityComment(p, interactionsSlug, interactionsUpdate)).ok,
  ).toBe(false);
  p.like.mockResolvedValue(ok({ ...interactionsLiked, liked: false }));
  expect(
    (await setCommunityLike(p, interactionsSlug, interactionsLike)).ok,
  ).toBe(false);
});
it('requires confirmed deletion without a service call', async () => {
  const p = port();
  expect(
    await deleteCommunityComment(p, interactionsSlug, {
      ...interactionsDelete,
      confirmed: false,
    }),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(p.delete).not.toHaveBeenCalled();
});
it('read propagates safe denial and sanitizes thrown failure', async () => {
  const p = port();
  p.list.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
  expect(
    await listCommunityInteractions(p, interactionsQuery, interactionsActorId),
  ).toEqual({ ok: false, code: 'FORBIDDEN' });
  p.list.mockRejectedValue(new Error('private'));
  expect(
    await listCommunityInteractions(p, interactionsQuery, interactionsActorId),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('rejects invalid temporal fields rather than accepting rounded cursor input', () => {
  for (const created_at of [
    '0000-01-01T00:00:00Z',
    '2026-10-25T10:00:00.0000001Z',
    'not date',
    '2026-02-31T10:00:00Z',
  ]) {
    expect(
      communityInteractionsSchema.safeParse({
        ...interactionsPage,
        comments: [{ ...interactionsComment, created_at }],
      }).success,
    ).toBe(false);
  }
});
it('keeps historic receipt success separate from current like state', async () => {
  const p = port();
  expect(await setCommunityLike(p, interactionsSlug, interactionsLike)).toEqual(
    ok(interactionsLiked),
  );
  expect(
    await listCommunityInteractions(p, interactionsQuery, interactionsActorId),
  ).toEqual(ok(interactionsPage));
  expect(interactionsPage.liked).toBe(false);
});
