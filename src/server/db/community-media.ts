import 'server-only';
import { z } from 'zod';
import type { CommunityError, CommunityResult } from '@/config/community-posts';
import {
  communityReadSnapshotSchema,
  communityUploadSnapshotSchema,
  type CommunityMediaPort,
} from '@/server/services/community-posts/media-model';
import type { MediaServiceClient } from './media-client';

const errors: Record<string, CommunityError> = {
  COMMUNITY_FORBIDDEN: 'FORBIDDEN',
  COMMUNITY_SERVICE_REQUIRED: 'FORBIDDEN',
  COMMUNITY_BOARD_UNAVAILABLE: 'NOT_FOUND',
  COMMUNITY_TARGET_UNAVAILABLE: 'NOT_FOUND',
  COMMUNITY_POLICY_REQUIRED: 'SETUP_NOT_READY',
  COMMUNITY_POLICY_INVALID: 'SETUP_NOT_READY',
  COMMUNITY_IMAGE_INVALID: 'INVALID_CONTENT',
  COMMUNITY_IMAGE_LIMIT: 'LIMIT_EXCEEDED',
  COMMUNITY_IDEMPOTENCY_CONFLICT: 'CONFLICT',
  COMMUNITY_REQUEST_REQUIRED: 'INVALID_INPUT',
  BOARD_INVALID_INPUT: 'INVALID_INPUT',
  BOARD_ISOLATION_UNSUPPORTED: 'UNAVAILABLE',
  BOARD_OPERATION_CONFLICT: 'CONFLICT',
  BOARD_IMAGE_INVALID: 'INVALID_CONTENT',
  BOARD_IMAGE_LIMIT: 'LIMIT_EXCEEDED',
  BOARD_UPLOAD_EXPIRED: 'EXPIRED',
  BOARD_UPLOAD_REVOKED: 'FORBIDDEN',
  BOARD_MEDIA_INVALID: 'INVALID_INPUT',
  BOARD_MEDIA_EXPIRED: 'EXPIRED',
  BOARD_MEDIA_REVOKED: 'FORBIDDEN',
  BOARD_MEDIA_NOT_FOUND: 'NOT_FOUND',
  BOARD_MEDIA_CONFLICT: 'CONFLICT',
  BOARD_MEDIA_LIMIT: 'LIMIT_EXCEEDED',
};
function parsed<T>(
  schema: z.ZodType<T>,
  data: unknown,
  error: unknown,
): CommunityResult<T> {
  if (error) {
    const issue = z.object({ message: z.string() }).safeParse(error);
    return {
      ok: false,
      code:
        issue.success && Object.hasOwn(errors, issue.data.message)
          ? errors[issue.data.message]!
          : 'UNAVAILABLE',
    };
  }
  const result = schema.safeParse(data);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, code: 'UNAVAILABLE' };
}
export function createCommunityMediaPort(
  client: MediaServiceClient,
): CommunityMediaPort {
  return {
    async begin(actorId, input) {
      const { data, error } = await client.rpc('board_media_begin_upload', {
        p_actor_id: actorId,
        p_artist_id: input.artistId,
        p_post_id: input.postId,
        p_mime_type: input.mimeType,
        p_byte_size: input.byteSize,
        p_request_id: input.requestId,
      });
      return parsed(communityUploadSnapshotSchema, data, error);
    },
    async resolve(actorId, uploadId) {
      const { data, error } = await client.rpc('board_media_resolve_upload', {
        p_actor_id: actorId,
        p_upload_id: uploadId,
      });
      return parsed(communityUploadSnapshotSchema, data, error);
    },
    async finalize(actorId, uploadId, objectId, metadata) {
      const { data, error } = await client.rpc('board_media_finalize_upload', {
        p_actor_id: actorId,
        p_upload_id: uploadId,
        p_storage_object_id: objectId,
        p_width: metadata.width,
        p_height: metadata.height,
      });
      return parsed(z.uuid(), data, error);
    },
    async revoke(actorId, uploadId) {
      const { data, error } = await client.rpc('board_media_revoke_upload', {
        p_actor_id: actorId,
        p_upload_id: uploadId,
      });
      const result = parsed(z.boolean(), data, error);
      return !result.ok
        ? result
        : result.data
          ? { ok: true, data: null }
          : { ok: false, code: 'FORBIDDEN' };
    },
    async read(actorId, imageId) {
      const { data, error } = await client.rpc('board_media_resolve_read', {
        p_actor_id: actorId,
        p_image_id: imageId,
      });
      return parsed(communityReadSnapshotSchema, data, error);
    },
  };
}
