import 'server-only';
import { z } from 'zod';
import {
  composeArtistSchema,
  COMPOSE_ARTIST_PAGE_SIZE,
} from '@/config/artist-compose';
import {
  ACTIVITY_PAGE_SIZE,
  artistReplyActivityMessageSchema,
  artistReplyActivityReplySchema,
  artistReplyActivityWeekSchema,
  artistReplyActivityPageSchema,
  artistReplyActivityMessagesSchema,
  type ArtistReplyActivityError,
  type ArtistReplyActivityResult,
} from '@/config/artist-reply-activity';
import type {
  ArtistReplyActivityPort,
  ArtistReplyActivityCatalogPort,
} from '@/server/services/artist-reply-activity/activity';
import type { ActorClient } from './client';

const codes: Record<string, ArtistReplyActivityError> = {
  ARTIST_REPLY_FORBIDDEN: 'FORBIDDEN',
  ARTIST_REPLY_NOT_FOUND: 'NOT_FOUND',
  ARTIST_REPLY_INVALID_INPUT: 'INVALID_INPUT',
};
function parsed<T>(
  schema: z.ZodType<T>,
  value: unknown,
): ArtistReplyActivityResult<T> {
  const result = schema.safeParse(value);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, code: 'UNAVAILABLE' };
}
function failure(message: string): ArtistReplyActivityResult<never> {
  return {
    ok: false,
    code: Object.hasOwn(codes, message) ? codes[message]! : 'UNAVAILABLE',
  };
}
const messageSchema = z
  .object({ id: z.unknown(), kind: z.unknown(), sent_at: z.unknown() })
  .transform((row) => ({ id: row.id, kind: row.kind, sentAt: row.sent_at }))
  .pipe(artistReplyActivityMessageSchema);
const replySchema = z
  .object({
    id: z.unknown(),
    call_name: z.unknown(),
    body: z.unknown(),
    created_at: z.unknown(),
    message_id: z.unknown(),
  })
  .transform((row) => ({
    id: row.id,
    callName: row.call_name,
    body: row.body,
    createdAt: row.created_at,
    messageId: row.message_id,
  }))
  .pipe(artistReplyActivityReplySchema);
const activitySchema = z
  .object({
    week_start: z.unknown(),
    week_end: z.unknown(),
    message_count: z.unknown(),
    photo_count: z.unknown(),
    weekly_message_min: z.unknown(),
    weekly_photo_min: z.unknown(),
    requirements_ready: z.unknown(),
  })
  .transform((row) => ({
    weekStart: row.week_start,
    weekEnd: row.week_end,
    messageCount: row.message_count,
    photoCount: row.photo_count,
    weeklyMessageMin: row.weekly_message_min,
    weeklyPhotoMin: row.weekly_photo_min,
    requirementsReady: row.requirements_ready,
  }))
  .pipe(artistReplyActivityWeekSchema);
const pageSchema = z
  .object({
    artist: composeArtistSchema,
    server_now: z.unknown(),
    replies: z.array(replySchema).max(ACTIVITY_PAGE_SIZE),
    selected_message: messageSchema.nullable(),
    has_more: z.boolean(),
    activity: activitySchema,
  })
  .transform((row) => ({
    artist: row.artist,
    serverNow: row.server_now,
    replies: row.replies,
    selectedMessage: row.selected_message,
    hasMore: row.has_more,
    activity: row.activity,
  }))
  .pipe(artistReplyActivityPageSchema.omit({ nextCursor: true }));
const messagesSchema = z
  .object({
    artist: composeArtistSchema,
    messages: z.array(messageSchema).max(ACTIVITY_PAGE_SIZE),
    has_more: z.boolean(),
  })
  .transform((row) => ({
    artist: row.artist,
    messages: row.messages,
    hasMore: row.has_more,
  }))
  .pipe(artistReplyActivityMessagesSchema.omit({ nextCursor: true }));

export function createArtistReplyActivityPort(
  client: ActorClient,
): ArtistReplyActivityPort {
  return {
    async context(slug, messageId, before) {
      const { data, error } = await client.rpc(
        'artist_reply_activity_context',
        {
          p_artist_slug: slug,
          ...(messageId !== null ? { p_message_id: messageId } : {}),
          ...(before
            ? { p_before_created_at: before.createdAt, p_before_id: before.id }
            : {}),
        },
      );
      return error ? failure(error.message) : parsed(pageSchema, data);
    },
    async messages(slug, before) {
      const { data, error } = await client.rpc(
        'artist_reply_activity_messages',
        {
          p_artist_slug: slug,
          ...(before
            ? { p_before_sent_at: before.sentAt, p_before_id: before.id }
            : {}),
        },
      );
      return error ? failure(error.message) : parsed(messagesSchema, data);
    },
  };
}
export function createArtistReplyActivityCatalogPort(
  client: ActorClient,
): ArtistReplyActivityCatalogPort {
  return {
    async artists(afterSlug) {
      const { data, error } = await client.rpc(
        'artist_reply_activity_artists',
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
