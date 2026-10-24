import { z } from 'zod';
import { artistSlugSchema } from './artists';

// Technical transport bounds only. Active reply length/rate/content policy is DB-owned.
export const REPLY_PAGE_SIZE = 30;
export const REPLY_MAX_PAGE_SIZE = 100;
export const REPLY_MAX_BODY_LENGTH = 10_000;
export const REPLY_CURSOR_MAX_LENGTH = 512;
export const REPLY_BODY_LIMIT = 64_000;
export const REPLY_BODY_TIMEOUT_MS = 5_000;
export const REPLY_REQUEST_TIMEOUT_MS = 15_000;
export const REPLY_RESPONSE_MAX_BYTES = 8_000_000;
export const REPLY_HTTP_OK = 200;
export const REPLY_ERROR_STATUS = {
  INVALID_INPUT: 400,
  FORBIDDEN_CONTENT: 400,
  TOO_LONG: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  SUBSCRIPTION_REQUIRED: 403,
  PROFILE_REQUIRED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export type ReplyError = keyof typeof REPLY_ERROR_STATUS;
export type ReplyResult<T> =
  { ok: true; data: T } | { ok: false; code: ReplyError };
export const replyCursorSchema = z
  .string()
  .min(1)
  .max(REPLY_CURSOR_MAX_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/);
export const replyPageInputSchema = z.strictObject({
  slug: artistSlugSchema,
  cursor: replyCursorSchema.optional(),
  limit: z.number().int().min(1).max(REPLY_MAX_PAGE_SIZE).optional(),
});
export const replyWriteBodySchema = z.strictObject({
  operationId: z.uuid(),
  body: z
    .string()
    .min(1)
    .refine((value) => Array.from(value).length <= REPLY_MAX_BODY_LENGTH),
  messageId: z.uuid().nullable(),
});
export const replyWriteInputSchema = replyWriteBodySchema.extend({
  slug: artistSlugSchema,
});
export const ownReplySchema = z
  .object({
    id: z.uuid(),
    operationId: z.uuid().nullable(),
    messageId: z.uuid().nullable(),
    body: z.string().nullable(),
    blocked: z.boolean(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .refine((reply) =>
    reply.blocked ? reply.body === null : reply.body !== null,
  );
export const replyPageSchema = z.object({
  slug: artistSlugSchema,
  sendReady: z.boolean(),
  maxLength: z.number().int().positive().max(REPLY_MAX_BODY_LENGTH),
  replies: z.array(ownReplySchema).max(REPLY_MAX_PAGE_SIZE),
  nextCursor: replyCursorSchema.nullable(),
});
export const replyReceiptSchema = z.object({
  slug: artistSlugSchema,
  reply: ownReplySchema,
});
export type OwnReply = z.output<typeof ownReplySchema>;
export type ReplyPage = z.output<typeof replyPageSchema>;
export type ReplyPageInput = z.output<typeof replyPageInputSchema>;
export type ReplyWriteInput = z.output<typeof replyWriteInputSchema>;
export type ReplyReceipt = z.output<typeof replyReceiptSchema>;
