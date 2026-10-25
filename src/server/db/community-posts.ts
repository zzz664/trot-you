import 'server-only';
import { z } from 'zod';
import {
  COMMUNITY_POSTS,
  communityListSchema,
  communityDetailSchema,
  communityCreatedSchema,
  communityDeletedSchema,
  communityNoticeReceiptSchema,
  type CommunityError,
  type CommunityResult,
} from '@/config/community-posts';
import type { CommunityReadPort } from '@/server/services/community-posts/read';
import type { CommunityWritePort } from '@/server/services/community-posts/manage';
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
export function createCommunityPostsPort(
  client: ActorClient,
): CommunityReadPort & CommunityWritePort {
  return {
    async list(query) {
      const { data, error } = await client.rpc('board_ui_list', {
        p_artist_slug: query.slug,
        p_limit: COMMUNITY_POSTS.pageSize,
        ...(query.cursor === null
          ? {}
          : {
              p_before_pinned: query.cursor.is_pinned,
              p_before_created_at: query.cursor.created_at,
              p_before_id: query.cursor.id,
            }),
      });
      return parsed(communityListSchema, data, error);
    },
    async detail(query) {
      const { data, error } = await client.rpc('board_ui_detail', {
        p_artist_slug: query.slug,
        p_post_id: query.post_id,
      });
      return parsed(communityDetailSchema, data, error);
    },
    async create(slug, input) {
      const { data, error } = await client.rpc('board_ui_create', {
        p_artist_slug: slug,
        p_operation_id: input.operation_id,
        p_post_id: input.post_id,
        p_artist_id: input.artist_id,
        p_title: input.title,
        p_body: input.body,
        p_upload_ids: input.upload_ids,
        p_is_notice: input.is_notice,
        p_is_pinned: input.is_pinned,
      });
      return parsed(communityCreatedSchema, data, error);
    },
    async delete(slug, input) {
      const { data, error } = await client.rpc('board_ui_delete', {
        p_artist_slug: slug,
        p_operation_id: input.operation_id,
        p_post_id: input.post_id,
        p_expected_revision: input.expected_revision,
        p_confirmed: input.confirmed,
      });
      return parsed(communityDeletedSchema, data, error);
    },
    async notice(slug, input) {
      const { data, error } = await client.rpc('board_ui_notice', {
        p_artist_slug: slug,
        p_operation_id: input.operation_id,
        p_post_id: input.post_id,
        p_expected_revision: input.expected_revision,
        p_is_notice: input.is_notice,
        p_is_pinned: input.is_pinned,
      });
      return parsed(communityNoticeReceiptSchema, data, error);
    },
  };
}
