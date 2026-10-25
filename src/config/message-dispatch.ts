import { z } from 'zod';
import { artistSlugSchema } from './artists';
import {
  composeArtistSchema,
  composeKindSchema,
  composeMediaSchema,
  composeCatalogSchema,
} from './artist-compose';

export const dispatchCatalogSchema = composeCatalogSchema;
export type DispatchCatalog = z.output<typeof dispatchCatalogSchema>;

// Transport/execution ceilings only; cancellation policy remains DB-owned.
export const DISPATCH_PAGE_SIZE = 30;
export const DISPATCH_CURSOR_MAX_LENGTH = 1024;
export const DISPATCH_BODY_LIMIT = 8192;
export const DISPATCH_BODY_TIMEOUT_MS = 1000;
export const DISPATCH_REQUEST_TIMEOUT_MS = 30_000;
export const DISPATCH_RESPONSE_MAX_BYTES = 16_777_216;
export const DISPATCH_MAX_TEXT_LENGTH = 100_000;
export const DISPATCH_MAX_MEDIA_COUNT = 100;
export const DISPATCH_MAX_CANCEL_SECONDS = 86_400;
export const DISPATCH_CRON_SECRET_MIN_LENGTH = 32;
export const DISPATCH_CRON_SECRET_MAX_LENGTH = 256;
export const DISPATCH_HTTP_OK = 200;
export const DISPATCH_WORKER_LIMIT = 10;
export const DISPATCH_WORKER_REQUEST_TIMEOUT_MS = 30_000;
export const DISPATCH_CRON_STATUS = {
  OK: 200,
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export const dispatchWorkerSummarySchema = z
  .strictObject({
    published: z.number().int().nonnegative().max(DISPATCH_WORKER_LIMIT),
    blocked: z.number().int().nonnegative().max(DISPATCH_WORKER_LIMIT),
    skipped: z.number().int().nonnegative().max(DISPATCH_WORKER_LIMIT),
    hasMore: z.boolean(),
  })
  .refine(
    (summary) =>
      summary.published + summary.blocked + summary.skipped <=
      DISPATCH_WORKER_LIMIT,
  );
export type DispatchWorkerSummary = z.output<
  typeof dispatchWorkerSummarySchema
>;
export const DISPATCH_TIME_ZONE = 'Asia/Seoul';
export const DISPATCH_KST_OFFSET = '+09:00';
export const DISPATCH_ERROR_STATUS = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  MEDIA_PENDING: 409,
  CANCEL_WINDOW_PASSED: 409,
  RATE_LIMITED: 429,
  BACKPRESSURE: 503,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export type DispatchError = keyof typeof DISPATCH_ERROR_STATUS;
export type DispatchResult<T> =
  { ok: true; data: T } | { ok: false; code: DispatchError };
const instant = z.iso.datetime({ offset: true });
export const dispatchMessageSchema = z
  .strictObject({
    id: z.uuid(),
    kind: composeKindSchema,
    body: z
      .string()
      .max(DISPATCH_MAX_TEXT_LENGTH * 2)
      .nullable(),
    revision: z.number().int().positive().safe(),
    status: z.enum(['scheduled', 'sent', 'canceled']),
    createdAt: instant,
    scheduledAt: instant,
    sentAt: instant.nullable(),
    canceledAt: instant.nullable(),
    cancelBefore: instant.nullable(),
    canCancel: z.boolean(),
    notificationState: z.enum(['not_queued', 'queued', 'canceled']),
    dispatchError: z
      .enum([
        'author_unavailable',
        'content_invalid',
        'policy_unavailable',
        'backpressure',
      ])
      .nullable(),
    media: z.array(composeMediaSchema).max(DISPATCH_MAX_MEDIA_COUNT),
  })
  .refine(
    (item) =>
      new Set(item.media.map((media) => media.id)).size === item.media.length &&
      item.media.every((media) => media.kind === item.kind) &&
      (item.kind === 'photo' || item.media.length <= 1) &&
      (item.kind !== 'text' || item.body !== null) &&
      (item.status !== 'sent' || item.sentAt !== null) &&
      (item.status !== 'canceled' || item.canceledAt !== null) &&
      (item.status !== 'canceled' || !item.canCancel),
  );
export type DispatchMessage = z.output<typeof dispatchMessageSchema>;
export const dispatchPageSchema = z.strictObject({
  artist: composeArtistSchema,
  serverNow: instant,
  cancelWindowSeconds: z
    .number()
    .int()
    .nonnegative()
    .max(DISPATCH_MAX_CANCEL_SECONDS),
  messages: z.array(dispatchMessageSchema).max(DISPATCH_PAGE_SIZE),
  selectedMessage: dispatchMessageSchema.nullable(),
  hasMore: z.boolean(),
  nextCursor: z.string().max(DISPATCH_CURSOR_MAX_LENGTH).nullable(),
});
export type DispatchPageData = z.output<typeof dispatchPageSchema>;
export const dispatchPageInputSchema = z.strictObject({
  slug: artistSlugSchema,
  messageId: z.uuid().nullable(),
  cursor: z.string().min(1).max(DISPATCH_CURSOR_MAX_LENGTH).optional(),
});
export type DispatchPageInput = z.output<typeof dispatchPageInputSchema>;
export const dispatchSubmitSchema = z.strictObject({
  slug: artistSlugSchema,
  messageId: z.uuid(),
  operationId: z.uuid(),
  expectedRevision: z.number().int().positive().safe(),
  scheduledAt: instant.nullable(),
  confirmed: z.literal(true),
});
export type DispatchSubmitInput = z.output<typeof dispatchSubmitSchema>;
export const dispatchCancelSchema = z.strictObject({
  slug: artistSlugSchema,
  messageId: z.uuid(),
  operationId: z.uuid(),
  confirmed: z.literal(true),
});
export type DispatchCancelInput = z.output<typeof dispatchCancelSchema>;
