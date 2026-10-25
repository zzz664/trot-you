// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { COMMUNITY_POSTS } from '@/config/community-posts';
import { createCommunityPostsPort } from '@/server/db/community-posts';
import type { ActorClient } from '@/server/db/client';
import {
  boardArtist,
  boardPostId,
  boardList,
  boardDetail,
  boardCreate,
  boardDelete,
  boardNotice,
  boardCreated,
  boardDeleted,
  boardNoticeReceipt,
  boardSummary,
  boardOtherId,
} from './community-posts-fixtures';
function fixture(data: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    rpc,
    port: createCommunityPostsPort({ rpc } as unknown as ActorClient),
  };
}
const listQuery = { slug: boardArtist.slug, cursor: null },
  detailQuery = { slug: boardArtist.slug, post_id: boardPostId };
it('lists with server bound and omitted nullable initial cursor, never actor impersonation', async () => {
  const f = fixture(boardList);
  expect(await f.port.list(listQuery)).toEqual({ ok: true, data: boardList });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('board_ui_list', {
    p_artist_slug: boardArtist.slug,
    p_limit: COMMUNITY_POSTS.pageSize,
  });
});
it('continuation passes all three pinned/date/id tuple values without offset pagination', async () => {
  const f = fixture({ ...boardList, posts: [] });
  const cursor = {
    is_pinned: false,
    created_at: boardSummary.created_at,
    id: boardOtherId,
  };
  await f.port.list({ ...listQuery, cursor });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('board_ui_list', {
    p_artist_slug: boardArtist.slug,
    p_limit: COMMUNITY_POSTS.pageSize,
    p_before_pinned: false,
    p_before_created_at: cursor.created_at,
    p_before_id: cursor.id,
  });
});
it('detail binds post and artist slug in one RPC', async () => {
  const f = fixture(boardDetail);
  expect(await f.port.detail(detailQuery)).toEqual({
    ok: true,
    data: boardDetail,
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('board_ui_detail', {
    p_artist_slug: boardArtist.slug,
    p_post_id: boardPostId,
  });
});
it('atomic create passes exact operation, staged image IDs and notice intent', async () => {
  const f = fixture(boardCreated);
  expect(await f.port.create(boardArtist.slug, boardCreate)).toEqual({
    ok: true,
    data: boardCreated,
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('board_ui_create', {
    p_artist_slug: boardArtist.slug,
    p_operation_id: boardCreate.operation_id,
    p_post_id: boardPostId,
    p_artist_id: boardCreate.artist_id,
    p_title: boardCreate.title,
    p_body: boardCreate.body,
    p_upload_ids: [],
    p_is_notice: false,
    p_is_pinned: false,
  });
});
it('owner soft delete preserves confirmation and original revision for replay', async () => {
  const f = fixture(boardDeleted);
  expect(await f.port.delete(boardArtist.slug, boardDelete)).toEqual({
    ok: true,
    data: boardDeleted,
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('board_ui_delete', {
    p_artist_slug: boardArtist.slug,
    p_operation_id: boardDelete.operation_id,
    p_post_id: boardPostId,
    p_expected_revision: 1,
    p_confirmed: true,
  });
});
it('admin notice writes exact desired state not non-idempotent toggle', async () => {
  const f = fixture(boardNoticeReceipt);
  expect(await f.port.notice(boardArtist.slug, boardNotice)).toEqual({
    ok: true,
    data: boardNoticeReceipt,
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('board_ui_notice', {
    p_artist_slug: boardArtist.slug,
    p_operation_id: boardNotice.operation_id,
    p_post_id: boardPostId,
    p_expected_revision: 1,
    p_is_notice: true,
    p_is_pinned: true,
  });
});
it.each([
  ['COMMUNITY_FORBIDDEN', 'FORBIDDEN'],
  ['COMMUNITY_BOARD_UNAVAILABLE', 'NOT_FOUND'],
  ['COMMUNITY_TARGET_UNAVAILABLE', 'NOT_FOUND'],
  ['COMMUNITY_POLICY_REQUIRED', 'SETUP_NOT_READY'],
  ['COMMUNITY_POLICY_INVALID', 'SETUP_NOT_READY'],
  ['COMMUNITY_CONTENT_INVALID', 'INVALID_INPUT'],
  ['COMMUNITY_CONTENT_BLOCKED', 'CONTENT_BLOCKED'],
  ['COMMUNITY_RATE_LIMITED', 'RATE_LIMITED'],
  ['COMMUNITY_IDEMPOTENCY_CONFLICT', 'CONFLICT'],
  ['COMMUNITY_REQUEST_REQUIRED', 'INVALID_INPUT'],
  ['COMMUNITY_IMAGE_INVALID', 'INVALID_CONTENT'],
  ['COMMUNITY_IMAGE_LIMIT', 'LIMIT_EXCEEDED'],
  ['BOARD_INVALID_INPUT', 'INVALID_INPUT'],
  ['BOARD_FORBIDDEN', 'FORBIDDEN'],
  ['BOARD_NOT_FOUND', 'NOT_FOUND'],
  ['BOARD_TARGET_UNAVAILABLE', 'NOT_FOUND'],
  ['BOARD_REVISION_CONFLICT', 'CONFLICT'],
  ['BOARD_OPERATION_CONFLICT', 'CONFLICT'],
  ['BOARD_CONFIRMATION_REQUIRED', 'CONFIRMATION_REQUIRED'],
  ['BOARD_IMAGE_INVALID', 'INVALID_CONTENT'],
  ['BOARD_IMAGE_LIMIT', 'LIMIT_EXCEEDED'],
  ['BOARD_UPLOAD_EXPIRED', 'EXPIRED'],
  ['BOARD_UPLOAD_UNAVAILABLE', 'NOT_FOUND'],
  ['private SQL diagnostic', 'UNAVAILABLE'],
])('maps %s without forwarding SQL details', async (message, code) => {
  const f = fixture(null, { message });
  for (const result of await Promise.all([
    f.port.list(listQuery),
    f.port.detail(detailQuery),
    f.port.create(boardArtist.slug, boardCreate),
    f.port.delete(boardArtist.slug, boardDelete),
    f.port.notice(boardArtist.slug, boardNotice),
  ]))
    expect(result).toEqual({ ok: false, code });
});
it.each([
  null,
  [],
  {},
  { ...boardList, secret: 'private' },
  { ...boardList, posts: [{ ...boardSummary, body: 'unapproved projection' }] },
  { ...boardList, artist: { ...boardArtist, email: 'private' } },
])('rejects malformed list wire %#', async (data) =>
  expect(await fixture(data).port.list(listQuery)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  }),
);
it.each([
  null,
  [],
  {},
  {
    ...boardDetail,
    post: {
      ...boardDetail.post,
      images: [{ id: boardOtherId, object_path: 'private' }],
    },
  },
])('rejects malformed detail wire %#', async (data) =>
  expect(await fixture(data).port.detail(detailQuery)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  }),
);
it('does not claim success for empty/malformed mutation receipts', async () => {
  const f = fixture(null);
  for (const result of await Promise.all([
    f.port.create(boardArtist.slug, boardCreate),
    f.port.delete(boardArtist.slug, boardDelete),
    f.port.notice(boardArtist.slug, boardNotice),
  ]))
    expect(result).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
