// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { COMMUNITY_INTERACTIONS } from '@/config/community-interactions';
import { createCommunityInteractionsPort } from '@/server/db/community-interactions';
import type { ActorClient } from '@/server/db/client';
import {
  interactionsQuery,
  interactionsSlug,
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
function fixture(data: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    rpc,
    port: createCommunityInteractionsPort({ rpc } as unknown as ActorClient),
  };
}
it('reads server-bound page size and omits the absent nullable tuple', async () => {
  const f = fixture(interactionsPage);
  expect(await f.port.list(interactionsQuery)).toEqual({
    ok: true,
    data: interactionsPage,
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('community_ui_interactions', {
    p_artist_slug: interactionsSlug,
    p_post_id: interactionsQuery.post_id,
    p_limit: COMMUNITY_INTERACTIONS.pageSize,
  });
});
it('passes the exact ascending cursor timestamp and UUID', async () => {
  const f = fixture(interactionsPage),
    cursor = {
      created_at: interactionsComment.created_at,
      id: interactionsComment.id,
    };
  await f.port.list({ ...interactionsQuery, cursor });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('community_ui_interactions', {
    p_artist_slug: interactionsSlug,
    p_post_id: interactionsQuery.post_id,
    p_limit: COMMUNITY_INTERACTIONS.pageSize,
    p_after_created_at: cursor.created_at,
    p_after_id: cursor.id,
  });
});
it('create passes the same operation/comment identities and exact original body', async () => {
  const f = fixture(interactionsCreated);
  expect(await f.port.create(interactionsSlug, interactionsCreate)).toEqual({
    ok: true,
    data: interactionsCreated,
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('community_ui_create_comment', {
    p_artist_slug: interactionsSlug,
    p_operation_id: interactionsCreate.operation_id,
    p_post_id: interactionsCreate.post_id,
    p_comment_id: interactionsCreate.comment_id,
    p_body: interactionsCreate.body,
  });
});
it('update passes original operation and expected revision', async () => {
  const f = fixture(interactionsUpdated);
  expect(await f.port.update(interactionsSlug, interactionsUpdate)).toEqual({
    ok: true,
    data: interactionsUpdated,
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('community_ui_update_comment', {
    p_artist_slug: interactionsSlug,
    p_operation_id: interactionsUpdate.operation_id,
    p_post_id: interactionsUpdate.post_id,
    p_comment_id: interactionsUpdate.comment_id,
    p_body: interactionsUpdate.body,
    p_expected_revision: interactionsUpdate.expected_revision,
  });
});
it('delete retains confirmation and original expected revision for replay', async () => {
  const f = fixture(interactionsDeleted);
  expect(await f.port.delete(interactionsSlug, interactionsDelete)).toEqual({
    ok: true,
    data: interactionsDeleted,
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('community_ui_delete_comment', {
    p_artist_slug: interactionsSlug,
    p_operation_id: interactionsDelete.operation_id,
    p_post_id: interactionsDelete.post_id,
    p_comment_id: interactionsDelete.comment_id,
    p_confirmed: true,
    p_expected_revision: interactionsDelete.expected_revision,
  });
});
it('like writes explicit desired state instead of a non-idempotent toggle', async () => {
  const f = fixture(interactionsLiked);
  expect(await f.port.like(interactionsSlug, interactionsLike)).toEqual({
    ok: true,
    data: interactionsLiked,
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('community_ui_set_like', {
    p_artist_slug: interactionsSlug,
    p_operation_id: interactionsLike.operation_id,
    p_post_id: interactionsLike.post_id,
    p_liked: true,
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
  ['BOARD_INVALID_INPUT', 'INVALID_INPUT'],
  ['BOARD_REVISION_CONFLICT', 'CONFLICT'],
  ['BOARD_OPERATION_CONFLICT', 'CONFLICT'],
  ['BOARD_CONFIRMATION_REQUIRED', 'CONFIRMATION_REQUIRED'],
  ['BOARD_ISOLATION_UNSUPPORTED', 'UNAVAILABLE'],
  ['private SQL diagnostic', 'UNAVAILABLE'],
])('maps %s without leaking raw diagnostics', async (message, code) => {
  const { port } = fixture(null, { message });
  const results = await Promise.all([
    port.list(interactionsQuery),
    port.create(interactionsSlug, interactionsCreate),
    port.update(interactionsSlug, interactionsUpdate),
    port.delete(interactionsSlug, interactionsDelete),
    port.like(interactionsSlug, interactionsLike),
  ]);
  expect(results).toEqual(results.map(() => ({ ok: false, code })));
});
it.each([
  null,
  [],
  {},
  { ...interactionsPage, secret: 'private' },
  {
    ...interactionsPage,
    comments: [{ ...interactionsComment, user_id: interactionsPage.actor_id }],
  },
])('rejects malformed private list wire %#', async (data) => {
  expect(await fixture(data).port.list(interactionsQuery)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it.each([null, [], {}, { ...interactionsCreated, secret: 'private' }])(
  'does not claim mutation success for malformed receipt %#',
  async (data) => {
    const { port } = fixture(data);
    const results = await Promise.all([
      port.create(interactionsSlug, interactionsCreate),
      port.update(interactionsSlug, interactionsUpdate),
      port.delete(interactionsSlug, interactionsDelete),
      port.like(interactionsSlug, interactionsLike),
    ]);
    expect(results).toEqual(
      results.map(() => ({ ok: false, code: 'UNAVAILABLE' })),
    );
  },
);
