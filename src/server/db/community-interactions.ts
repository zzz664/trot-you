import 'server-only';
import { z } from 'zod';
import {
  COMMUNITY_INTERACTIONS,
  communityInteractionsSchema,
  communityCommentReceiptSchema,
  communityCommentDeletedSchema,
  communityLikeReceiptSchema,
} from '@/config/community-interactions';
import type { CommunityError, CommunityResult } from '@/config/community-posts';
import type { CommunityInteractionsReadPort } from '@/server/services/community-interactions/read';
import type { CommunityInteractionsWritePort } from '@/server/services/community-interactions/manage';
import type { ActorClient } from './client';
const errors: Record<string, CommunityError> = {
  COMMUNITY_FORBIDDEN: 'FORBIDDEN',
  COMMUNITY_BOARD_UNAVAILABLE: 'NOT_FOUND',
  COMMUNITY_TARGET_UNAVAILABLE: 'NOT_FOUND',
  COMMUNITY_POLICY_REQUIRED: 'SETUP_NOT_READY',
  COMMUNITY_POLICY_INVALID: 'SETUP_NOT_READY',
  COMMUNITY_CONTENT_INVALID: 'INVALID_INPUT',
  COMMUNITY_CONTENT_BLOCKED: 'CONTENT_BLOCKED',
  COMMUNITY_RATE_LIMITED: 'RATE_LIMITED',
  COMMUNITY_IDEMPOTENCY_CONFLICT: 'CONFLICT',
  COMMUNITY_REQUEST_REQUIRED: 'INVALID_INPUT',
  COMMUNITY_IMAGE_INVALID: 'INVALID_CONTENT',
  COMMUNITY_IMAGE_LIMIT: 'LIMIT_EXCEEDED',
  BOARD_INVALID_INPUT: 'INVALID_INPUT',
  BOARD_FORBIDDEN: 'FORBIDDEN',
  BOARD_NOT_FOUND: 'NOT_FOUND',
  BOARD_TARGET_UNAVAILABLE: 'NOT_FOUND',
  BOARD_REVISION_CONFLICT: 'CONFLICT',
  BOARD_OPERATION_CONFLICT: 'CONFLICT',
  BOARD_CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  BOARD_IMAGE_INVALID: 'INVALID_CONTENT',
  BOARD_IMAGE_LIMIT: 'LIMIT_EXCEEDED',
  BOARD_UPLOAD_EXPIRED: 'EXPIRED',
  BOARD_UPLOAD_UNAVAILABLE: 'NOT_FOUND',
};
function parsed<T>(
  schema: z.ZodType<T>,
  data: unknown,
  error: { message: string } | null,
): CommunityResult<T> {
  if (error)
    return {
      ok: false,
      code: Object.hasOwn(errors, error.message)
        ? errors[error.message]!
        : 'UNAVAILABLE',
    };
  const result = schema.safeParse(data);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, code: 'UNAVAILABLE' };
}
export function createCommunityInteractionsPort(
  client: ActorClient,
): CommunityInteractionsReadPort & CommunityInteractionsWritePort {
  return {
    async list(query) {
      const { data, error } = await client.rpc('community_ui_interactions', {
        p_artist_slug: query.slug,
        p_post_id: query.post_id,
        p_limit: COMMUNITY_INTERACTIONS.pageSize,
        ...(query.cursor === null
          ? {}
          : {
              p_after_created_at: query.cursor.created_at,
              p_after_id: query.cursor.id,
            }),
      });
      return parsed(communityInteractionsSchema, data, error);
    },
    async create(slug, input) {
      const { data, error } = await client.rpc('community_ui_create_comment', {
        p_artist_slug: slug,
        p_operation_id: input.operation_id,
        p_post_id: input.post_id,
        p_comment_id: input.comment_id,
        p_body: input.body,
      });
      return parsed(communityCommentReceiptSchema, data, error);
    },
    async update(slug, input) {
      const { data, error } = await client.rpc('community_ui_update_comment', {
        p_artist_slug: slug,
        p_operation_id: input.operation_id,
        p_post_id: input.post_id,
        p_comment_id: input.comment_id,
        p_expected_revision: input.expected_revision,
        p_body: input.body,
      });
      return parsed(communityCommentReceiptSchema, data, error);
    },
    async delete(slug, input) {
      const { data, error } = await client.rpc('community_ui_delete_comment', {
        p_artist_slug: slug,
        p_operation_id: input.operation_id,
        p_post_id: input.post_id,
        p_comment_id: input.comment_id,
        p_expected_revision: input.expected_revision,
        p_confirmed: input.confirmed,
      });
      return parsed(communityCommentDeletedSchema, data, error);
    },
    async like(slug, input) {
      const { data, error } = await client.rpc('community_ui_set_like', {
        p_artist_slug: slug,
        p_operation_id: input.operation_id,
        p_post_id: input.post_id,
        p_liked: input.liked,
      });
      return parsed(communityLikeReceiptSchema, data, error);
    },
  };
}
