import 'server-only';
import { z } from 'zod';
import {
  COMPOSE_ARTIST_PAGE_SIZE,
  COMPOSE_PAGE_SIZE,
  composeArtistSchema,
  composeDraftSchema,
  composePolicySchema,
  type ComposeError,
  type ComposeResult,
} from '@/config/artist-compose';
import type { ComposePort } from '@/server/services/artist-compose/compose';
import type { ActorClient } from './client';

const codes: Record<string, ComposeError> = {
  COMPOSE_INVALID_INPUT: 'INVALID_INPUT',
  COMPOSE_CONTENT_INVALID: 'INVALID_INPUT',
  COMPOSE_TOO_LONG: 'TOO_LONG',
  COMPOSE_FORBIDDEN: 'FORBIDDEN',
  COMPOSE_NOT_FOUND: 'NOT_FOUND',
  COMPOSE_CONFLICT: 'CONFLICT',
  COMPOSE_NOT_DRAFT: 'CONFLICT',
  COMPOSE_OPERATION_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  COMPOSE_MEDIA_CONFLICT: 'CONFLICT',
  COMPOSE_MANAGED_DRAFT: 'FORBIDDEN',
  COMPOSE_REVISION_CONFLICT: 'CONFLICT',
  COMPOSE_IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  COMPOSE_MEDIA_PENDING: 'MEDIA_PENDING',
  COMPOSE_LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
  COMPOSE_SETUP_NOT_READY: 'SETUP_NOT_READY',
  MESSAGE_POLICY_REQUIRED: 'SETUP_NOT_READY',
  ONBOARDING_POLICY_REQUIRED: 'SETUP_NOT_READY',
  MESSAGE_CONTENT_INVALID: 'INVALID_INPUT',
  MESSAGE_NOT_FOUND: 'NOT_FOUND',
  MESSAGE_NOT_DRAFT: 'CONFLICT',
  MESSAGE_MEDIA_TYPE_CONFLICT: 'CONFLICT',
};
function failure(message: string): ComposeResult<never> {
  return {
    ok: false,
    code: Object.hasOwn(codes, message) ? codes[message]! : 'UNAVAILABLE',
  };
}
const draftSchema = z
  .object({
    id: z.unknown(),
    kind: z.unknown(),
    body: z.unknown(),
    revision: z.unknown(),
    updated_at: z.unknown(),
    media: z.array(
      z.object({
        id: z.unknown(),
        kind: z.unknown(),
        width: z.unknown(),
        height: z.unknown(),
        duration_ms: z.unknown(),
      }),
    ),
    pending_upload_ids: z.array(z.unknown()),
  })
  .transform((row) => ({
    id: row.id,
    kind: row.kind,
    body: row.body,
    revision: row.revision,
    updatedAt: row.updated_at,
    media: row.media.map((media) => ({
      id: media.id,
      kind: media.kind,
      width: media.width,
      height: media.height,
      durationMs: media.duration_ms,
    })),
    pendingUploadIds: row.pending_upload_ids,
  }))
  .pipe(composeDraftSchema);
const policySchema = z
  .object({
    max_text_length: z.unknown(),
    max_photo_count: z.unknown(),
    max_voice_seconds: z.unknown(),
    max_video_seconds: z.unknown(),
    photo_max_bytes: z.unknown(),
    voice_max_bytes: z.unknown(),
    video_max_bytes: z.unknown(),
    call_name_min_length: z.unknown(),
    call_name_max_length: z.unknown(),
  })
  .transform((row) => ({
    maxTextLength: row.max_text_length,
    maxPhotoCount: row.max_photo_count,
    maxVoiceSeconds: row.max_voice_seconds,
    maxVideoSeconds: row.max_video_seconds,
    photoMaxBytes: row.photo_max_bytes,
    voiceMaxBytes: row.voice_max_bytes,
    videoMaxBytes: row.video_max_bytes,
    callNameMinLength: row.call_name_min_length,
    callNameMaxLength: row.call_name_max_length,
  }))
  .pipe(composePolicySchema);
const pageSchema = z
  .object({
    artist: composeArtistSchema,
    policy: policySchema,
    drafts: z.array(draftSchema).max(COMPOSE_PAGE_SIZE),
    selected_draft: draftSchema.nullable(),
    has_more: z.boolean(),
  })
  .transform((row) => ({
    artist: row.artist,
    policy: row.policy,
    drafts: row.drafts,
    selectedDraft: row.selected_draft,
    hasMore: row.has_more,
  }));
const catalogSchema = z
  .object({
    artists: z.array(composeArtistSchema).max(COMPOSE_ARTIST_PAGE_SIZE),
    has_more: z.boolean(),
  })
  .transform((row) => ({ artists: row.artists, hasMore: row.has_more }));
function parsed<T>(schema: z.ZodType<T>, value: unknown): ComposeResult<T> {
  const result = schema.safeParse(value);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, code: 'UNAVAILABLE' };
}
export function createComposePort(client: ActorClient): ComposePort {
  return {
    async artists(afterSlug) {
      const { data, error } = await client.rpc(
        'artist_compose_artists',
        afterSlug === null ? {} : { p_after_slug: afterSlug },
      );
      return error ? failure(error.message) : parsed(catalogSchema, data);
    },
    async context(slug, messageId, before) {
      const { data, error } = await client.rpc('artist_compose_context', {
        p_artist_slug: slug,
        ...(messageId !== null ? { p_message_id: messageId } : {}),
        ...(before
          ? { p_before_updated_at: before.updatedAt, p_before_id: before.id }
          : {}),
      });
      return error ? failure(error.message) : parsed(pageSchema, data);
    },
    async save(input) {
      const { data, error } = await client.rpc('artist_compose_save', {
        p_artist_slug: input.slug,
        p_message_id: input.messageId,
        p_operation_id: input.operationId,
        p_expected_revision: input.expectedRevision,
        p_type: input.kind,
        ...(input.body !== null ? { p_body: input.body } : {}),
        p_media_ids: input.mediaIds,
      });
      return error ? failure(error.message) : parsed(draftSchema, data);
    },
    async remove(input) {
      const { data, error } = await client.rpc('artist_compose_remove_media', {
        p_artist_slug: input.slug,
        p_message_id: input.messageId,
        p_media_id: input.mediaId,
        p_operation_id: input.operationId,
        p_expected_revision: input.expectedRevision,
      });
      return error ? failure(error.message) : parsed(draftSchema, data);
    },
  };
}
