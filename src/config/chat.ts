import { z } from 'zod';
import { artistSlugSchema } from './artists';

// Technical bounds, not approved access/history policy. Policy remains in DB.
// The default page size is read from the audited database display setting.
export const CHAT_MAX_PAGE_SIZE = 100;
export const CHAT_CURSOR_MAX_LENGTH = 512;
export const CHAT_BODY_LIMIT = 1024;
export const CHAT_BODY_TIMEOUT_MS = 5000;
export const CHAT_REQUEST_TIMEOUT_MS = 15_000;
export const CHAT_RESPONSE_MAX_BYTES = 12_000_000;
export const CHAT_DISPLAY_TIME_ZONE = 'Asia/Seoul';
export const CHAT_HTTP_OK = 200;
export const CHAT_ERROR_STATUS = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  SUBSCRIPTION_REQUIRED: 403,
  PROFILE_REQUIRED: 409,
  NOT_FOUND: 404,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export type ChatError = keyof typeof CHAT_ERROR_STATUS;
export type ChatResult<T> =
  { ok: true; data: T } | { ok: false; code: ChatError };
export const chatCursorSchema = z
  .string()
  .min(1)
  .max(CHAT_CURSOR_MAX_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/);
export const chatPageInputSchema = z.strictObject({
  slug: artistSlugSchema,
  cursor: chatCursorSchema.optional(),
  limit: z.number().int().min(1).max(CHAT_MAX_PAGE_SIZE).optional(),
});
export const chatReadInputSchema = z.strictObject({
  slug: artistSlugSchema,
  messageId: z.uuid(),
});
export type ChatPageInput = z.output<typeof chatPageInputSchema>;
export type ChatReadInput = z.output<typeof chatReadInputSchema>;
export const chatMessageSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['text', 'photo', 'voice', 'video']),
  text: z.string().nullable(),
  sentAt: z.iso.datetime({ offset: true }),
  readAt: z.iso.datetime({ offset: true }).nullable(),
  media: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(['photo', 'voice', 'video']),
      availability: z.literal('available'),
    }),
  ),
});
export type ChatMessage = z.output<typeof chatMessageSchema>;
export const chatPageSchema = z
  .object({
    artist: z.object({
      slug: artistSlugSchema,
      name: z.string().min(1),
      description: z.string().nullable(),
    }),
    hasAccess: z.boolean(),
    messages: z.array(chatMessageSchema).max(CHAT_MAX_PAGE_SIZE),
    nextCursor: chatCursorSchema.nullable(),
    readCount: z.number().int().nonnegative().safe(),
  })
  .refine(
    (page) =>
      page.hasAccess ||
      (page.messages.length === 0 &&
        page.nextCursor === null &&
        page.readCount === 0),
  );
export type ChatPage = z.output<typeof chatPageSchema>;
export const chatReadReceiptSchema = z.object({
  messageId: z.uuid(),
  readAt: z.iso.datetime({ offset: true }),
  readCount: z.number().int().nonnegative().safe(),
});
export type ChatReadReceipt = z.output<typeof chatReadReceiptSchema>;
