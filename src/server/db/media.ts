import 'server-only';
import { z } from 'zod';
import type { MediaError, MediaResult } from '@/config/media';
import {
  mediaReadSnapshotSchema,
  mediaUploadSnapshotSchema,
  type MediaDbPort,
} from '@/server/services/media/model';
import type { MediaServiceClient } from './media-client';

const errors = {
  MEDIA_FORBIDDEN: 'FORBIDDEN',
  MESSAGE_AUTHOR_FORBIDDEN: 'FORBIDDEN',
  MESSAGE_ARTIST_UNAVAILABLE: 'FORBIDDEN',
  DISCOVERY_FORBIDDEN: 'FORBIDDEN',
  DISCOVERY_PROFILE_REQUIRED: 'FORBIDDEN',
  MEDIA_INPUT_INVALID: 'INVALID_INPUT',
  MEDIA_TYPE_INVALID: 'INVALID_INPUT',
  MEDIA_UPLOAD_CONFLICT: 'INVALID_INPUT',
  MEDIA_DRAFT_REQUIRED: 'FORBIDDEN',
  MEDIA_UPLOAD_REVOKED: 'FORBIDDEN',
  MEDIA_UPLOAD_EXPIRED: 'EXPIRED',
  MEDIA_LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
  MEDIA_COUNT_EXCEEDED: 'LIMIT_EXCEEDED',
  MEDIA_OBJECT_INVALID: 'INVALID_CONTENT',
  MEDIA_NOT_FOUND: 'NOT_FOUND',
  MEDIA_ACCESS_EXPIRED: 'EXPIRED',
  MEDIA_NOT_AVAILABLE: 'FORBIDDEN',
  MESSAGE_POLICY_REQUIRED: 'SETUP_NOT_READY',
  DISCOVERY_SETUP_NOT_READY: 'SETUP_NOT_READY',
  MEDIA_POLICY_REQUIRED: 'SETUP_NOT_READY',
} as const satisfies Record<string, MediaError>;
function failure(error: unknown): MediaResult<never> {
  const parsed = z.object({ message: z.string() }).safeParse(error);
  const key = parsed.success ? parsed.data.message : '';
  return {
    ok: false,
    code: Object.hasOwn(errors, key)
      ? errors[key as keyof typeof errors]
      : 'UNAVAILABLE',
  };
}
function parsed<T>(
  schema: z.ZodType<T>,
  data: unknown,
  error: unknown,
): MediaResult<T> {
  if (error) return failure(error);
  const result = schema.safeParse(data);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, code: 'UNAVAILABLE' };
}
export function createMediaDbPort(client: MediaServiceClient): MediaDbPort {
  return {
    async begin(actorId, input) {
      const { data, error } = await client.rpc('media_begin_upload', {
        p_actor_id: actorId,
        p_message_id: input.messageId,
        p_mime_type: input.mimeType,
        p_byte_size: input.byteSize,
        p_request_id: input.requestId,
      });
      return parsed(mediaUploadSnapshotSchema, data, error);
    },
    async resolve(actorId, uploadId) {
      const { data, error } = await client.rpc('media_resolve_upload', {
        p_actor_id: actorId,
        p_upload_id: uploadId,
      });
      return parsed(mediaUploadSnapshotSchema, data, error);
    },
    async finalize(actorId, uploadId, objectId, metadata) {
      // Supabase's generated scalar RPC args do not model SQL NULL. These
      // assertions preserve runtime nulls required by photo/voice shape checks;
      // they do not invent generated types or send sentinel dimensions.
      const { data, error } = await client.rpc('media_finalize_upload', {
        p_actor_id: actorId,
        p_upload_id: uploadId,
        p_storage_object_id: objectId,
        p_width: metadata.width!,
        p_height: metadata.height!,
        p_duration_ms: metadata.durationMs!,
      });
      return parsed(z.uuid(), data, error);
    },
    async revoke(actorId, uploadId) {
      const { data, error } = await client.rpc('media_revoke_upload', {
        p_actor_id: actorId,
        p_upload_id: uploadId,
      });
      const result = parsed(z.boolean(), data, error);
      if (!result.ok) return result;
      return result.data
        ? { ok: true, data: null }
        : { ok: false, code: 'FORBIDDEN' };
    },
    async read(actorId, mediaId, preview) {
      const { data, error } = await client.rpc('media_resolve_read', {
        p_actor_id: actorId,
        p_media_id: mediaId,
        p_preview: preview,
      });
      return parsed(mediaReadSnapshotSchema, data, error);
    },
  };
}
