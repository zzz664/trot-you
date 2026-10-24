import 'server-only';
import { z } from 'zod';
import { composeArtistSchema } from '@/config/artist-compose';
import {
  DISPATCH_PAGE_SIZE,
  dispatchMessageSchema,
  dispatchPageSchema,
  dispatchWorkerSummarySchema,
  type DispatchError,
  type DispatchResult,
} from '@/config/message-dispatch';
import type { DispatchPort } from '@/server/services/message-dispatch/dispatch';
import type { DispatchCatalogPort } from '@/server/services/message-dispatch/catalog';
import { COMPOSE_ARTIST_PAGE_SIZE } from '@/config/artist-compose';
import type { DispatchWorkerPort } from '@/server/services/message-dispatch/worker';
import type { ActorClient } from './client';
import type { CheckoutServiceClient } from './checkout-client';

const codes: Record<string, DispatchError> = {
  DISPATCH_INVALID_INPUT: 'INVALID_INPUT',
  DISPATCH_SCHEDULE_INVALID: 'INVALID_INPUT',
  DISPATCH_NOT_FOUND: 'NOT_FOUND',
  DISPATCH_NOT_DRAFT: 'CONFLICT',
  DISPATCH_REVISION_CONFLICT: 'CONFLICT',
  DISPATCH_OPERATION_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  DISPATCH_UPLOAD_PENDING: 'MEDIA_PENDING',
  DISPATCH_RATE_LIMITED: 'RATE_LIMITED',
  DISPATCH_BACKPRESSURE: 'BACKPRESSURE',
  DISPATCH_CONTENT_INVALID: 'INVALID_INPUT',
  DISPATCH_FORBIDDEN: 'FORBIDDEN',
  DISPATCH_SETUP_NOT_READY: 'SETUP_NOT_READY',
  COMPOSE_FORBIDDEN: 'FORBIDDEN',
  COMPOSE_NOT_FOUND: 'NOT_FOUND',
  COMPOSE_SETUP_NOT_READY: 'SETUP_NOT_READY',
  COMPOSE_INVALID_INPUT: 'INVALID_INPUT',
  MESSAGE_POLICY_REQUIRED: 'SETUP_NOT_READY',
  ONBOARDING_POLICY_REQUIRED: 'SETUP_NOT_READY',
  MESSAGE_CONTENT_INVALID: 'INVALID_INPUT',
  MESSAGE_NOT_FOUND: 'NOT_FOUND',
  MESSAGE_NOT_DRAFT: 'CONFLICT',
  MESSAGE_MEDIA_INVALID: 'INVALID_INPUT',
  MESSAGE_MEDIA_REQUIRED: 'INVALID_INPUT',
  MEDIA_OBJECT_CHANGED: 'INVALID_INPUT',
  CANCEL_WINDOW_PASSED: 'CANCEL_WINDOW_PASSED',
  MESSAGE_CANCEL_WINDOW_PASSED: 'CANCEL_WINDOW_PASSED',
};
function failure(message: string): DispatchResult<never> {
  return {
    ok: false,
    code: Object.hasOwn(codes, message) ? codes[message]! : 'UNAVAILABLE',
  };
}
function parsed<T>(schema: z.ZodType<T>, value: unknown): DispatchResult<T> {
  const result = schema.safeParse(value);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, code: 'UNAVAILABLE' };
}
const messageSchema = z
  .object({
    id: z.unknown(),
    kind: z.unknown(),
    body: z.unknown(),
    revision: z.unknown(),
    status: z.unknown(),
    created_at: z.unknown(),
    scheduled_at: z.unknown(),
    sent_at: z.unknown(),
    canceled_at: z.unknown(),
    cancel_before: z.unknown(),
    can_cancel: z.unknown(),
    notification_state: z.unknown(),
    dispatch_error: z.unknown(),
    media: z.array(
      z.object({
        id: z.unknown(),
        kind: z.unknown(),
        width: z.unknown(),
        height: z.unknown(),
        duration_ms: z.unknown(),
      }),
    ),
  })
  .transform((row) => ({
    id: row.id,
    kind: row.kind,
    body: row.body,
    revision: row.revision,
    status: row.status,
    createdAt: row.created_at,
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at,
    canceledAt: row.canceled_at,
    cancelBefore: row.cancel_before,
    canCancel: row.can_cancel,
    notificationState: row.notification_state,
    dispatchError: row.dispatch_error,
    media: row.media.map((media) => ({
      id: media.id,
      kind: media.kind,
      width: media.width,
      height: media.height,
      durationMs: media.duration_ms,
    })),
  }))
  .pipe(dispatchMessageSchema);
const pageSchema = z
  .object({
    artist: composeArtistSchema,
    server_now: z.unknown(),
    cancel_window_seconds: z.unknown(),
    messages: z.array(messageSchema).max(DISPATCH_PAGE_SIZE),
    selected_message: messageSchema.nullable(),
    has_more: z.boolean(),
  })
  .transform((row) => ({
    artist: row.artist,
    serverNow: row.server_now,
    cancelWindowSeconds: row.cancel_window_seconds,
    messages: row.messages,
    selectedMessage: row.selected_message,
    hasMore: row.has_more,
  }))
  .pipe(dispatchPageSchema.omit({ nextCursor: true }));

export function createDispatchPort(client: ActorClient): DispatchPort {
  return {
    async context(slug, messageId, before) {
      const { data, error } = await client.rpc('artist_dispatch_context', {
        p_artist_slug: slug,
        ...(messageId !== null ? { p_message_id: messageId } : {}),
        ...(before
          ? { p_before_created_at: before.createdAt, p_before_id: before.id }
          : {}),
      });
      return error ? failure(error.message) : parsed(pageSchema, data);
    },
    async submit(input) {
      const { data, error } = await client.rpc('artist_dispatch_submit', {
        p_artist_slug: input.slug,
        p_message_id: input.messageId,
        p_operation_id: input.operationId,
        p_expected_revision: input.expectedRevision,
        ...(input.scheduledAt !== null
          ? { p_scheduled_at: input.scheduledAt }
          : {}),
      });
      return error ? failure(error.message) : parsed(messageSchema, data);
    },
    async cancel(input) {
      const { data, error } = await client.rpc('artist_dispatch_cancel', {
        p_artist_slug: input.slug,
        p_message_id: input.messageId,
        p_operation_id: input.operationId,
      });
      return error ? failure(error.message) : parsed(messageSchema, data);
    },
  };
}
export function createDispatchCatalogPort(
  client: ActorClient,
): DispatchCatalogPort {
  return {
    async artists(afterSlug) {
      const { data, error } = await client.rpc(
        'artist_dispatch_artists',
        afterSlug === null ? {} : { p_after_slug: afterSlug },
      );
      const schema = z
        .object({
          artists: z.array(composeArtistSchema).max(COMPOSE_ARTIST_PAGE_SIZE),
          has_more: z.boolean(),
        })
        .transform((row) => ({ artists: row.artists, hasMore: row.has_more }));
      return error ? failure(error.message) : parsed(schema, data);
    },
  };
}
export function createDispatchWorkerPort(
  client: CheckoutServiceClient,
): DispatchWorkerPort {
  return {
    async run(limit) {
      const { data, error } = await client.rpc('message_dispatch_run', {
        p_limit: limit,
      });
      if (error) return { ok: false, code: 'UNAVAILABLE' };
      const schema = z
        .object({
          published: z.unknown(),
          blocked: z.unknown(),
          skipped: z.unknown(),
          has_more: z.unknown(),
        })
        .transform((row) => ({
          published: row.published,
          blocked: row.blocked,
          skipped: row.skipped,
          hasMore: row.has_more,
        }))
        .pipe(dispatchWorkerSummarySchema);
      const result = parsed(schema, data);
      return result.ok ? result : { ok: false, code: 'UNAVAILABLE' };
    },
  };
}
