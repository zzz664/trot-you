import { z } from 'zod';
import { artistSlugSchema } from './artists';
import {
  composeArtistSchema,
  composeCatalogSchema,
  composeKindSchema,
} from './artist-compose';

// Transport bounds, not operational activity requirements or reply policy.
export const ACTIVITY_PAGE_SIZE = 30;
export const ACTIVITY_CURSOR_MAX_LENGTH = 1024;
export const ACTIVITY_BODY_LIMIT = 8192;
export const ACTIVITY_BODY_TIMEOUT_MS = 1000;
export const ACTIVITY_REQUEST_TIMEOUT_MS = 30_000;
export const ACTIVITY_RESPONSE_MAX_BYTES = 4_194_304;
export const ACTIVITY_MAX_REPLY_LENGTH = 20_000;
export const ACTIVITY_MAX_CALL_NAME_LENGTH = 100;
export const ACTIVITY_HTTP_OK = 200;
export const ACTIVITY_TIME_ZONE = 'Asia/Seoul';
export const ACTIVITY_ERROR_STATUS = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export type ArtistReplyActivityError = keyof typeof ACTIVITY_ERROR_STATUS;
export type ArtistReplyActivityResult<T> =
  { ok: true; data: T } | { ok: false; code: ArtistReplyActivityError };
const instant = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative().safe();
const cursor = z
  .string()
  .min(1)
  .max(ACTIVITY_CURSOR_MAX_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/);
export const artistReplyActivityMessageSchema = z.strictObject({
  id: z.uuid(),
  kind: composeKindSchema,
  sentAt: instant,
});
export type ArtistReplyActivityMessage = z.output<
  typeof artistReplyActivityMessageSchema
>;
export const artistReplyActivityReplySchema = z.strictObject({
  id: z.uuid(),
  callName: z.string().min(1).max(ACTIVITY_MAX_CALL_NAME_LENGTH),
  body: z.string().min(1).max(ACTIVITY_MAX_REPLY_LENGTH),
  createdAt: instant,
  messageId: z.uuid().nullable(),
});
export type ArtistReplyActivityReply = z.output<
  typeof artistReplyActivityReplySchema
>;
export const artistReplyActivityWeekSchema = z
  .strictObject({
    weekStart: z.iso.date(),
    weekEnd: z.iso.date(),
    messageCount: count,
    photoCount: count,
    weeklyMessageMin: z.number().int().positive().safe().nullable(),
    weeklyPhotoMin: z.number().int().positive().safe().nullable(),
    requirementsReady: z.boolean(),
  })
  .refine(
    (value) =>
      value.photoCount <= value.messageCount &&
      value.weekStart < value.weekEnd &&
      (value.requirementsReady
        ? value.weeklyMessageMin !== null && value.weeklyPhotoMin !== null
        : value.weeklyMessageMin === null && value.weeklyPhotoMin === null),
  );
export const artistReplyActivityPageSchema = z.strictObject({
  artist: composeArtistSchema,
  serverNow: instant,
  activity: artistReplyActivityWeekSchema,
  replies: z.array(artistReplyActivityReplySchema).max(ACTIVITY_PAGE_SIZE),
  selectedMessage: artistReplyActivityMessageSchema.nullable(),
  hasMore: z.boolean(),
  nextCursor: cursor.nullable(),
});
export type ArtistReplyActivityPage = z.output<
  typeof artistReplyActivityPageSchema
>;
export const artistReplyActivityMessagesSchema = z.strictObject({
  artist: composeArtistSchema,
  messages: z.array(artistReplyActivityMessageSchema).max(ACTIVITY_PAGE_SIZE),
  hasMore: z.boolean(),
  nextCursor: cursor.nullable(),
});
export type ArtistReplyActivityMessages = z.output<
  typeof artistReplyActivityMessagesSchema
>;
export const artistReplyActivityPageInputSchema = z.strictObject({
  slug: artistSlugSchema,
  messageId: z.uuid().nullable(),
  cursor: cursor.optional(),
});
export type ArtistReplyActivityPageInput = z.output<
  typeof artistReplyActivityPageInputSchema
>;
export const artistReplyActivityMessagesInputSchema = z.strictObject({
  slug: artistSlugSchema,
  cursor: cursor.optional(),
});
export type ArtistReplyActivityMessagesInput = z.output<
  typeof artistReplyActivityMessagesInputSchema
>;
export const artistReplyActivityCatalogSchema = composeCatalogSchema;
export type ArtistReplyActivityCatalog = z.output<
  typeof artistReplyActivityCatalogSchema
>;
