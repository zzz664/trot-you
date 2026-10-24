import { z } from 'zod';

// Technical transport/security ceilings, not a replacement for the approved
// private.message_policy snapshot. No operational policy is seeded here.
export const MEDIA_BODY_LIMIT = 2048;
export const MEDIA_BODY_TIMEOUT_MS = 5000;
export const MEDIA_REQUEST_TIMEOUT_MS = 30_000;
export const MEDIA_RESPONSE_MAX_BYTES = 16_384;
export const MEDIA_READ_TTL_SECONDS = 60;
export const MEDIA_MILLISECONDS_PER_SECOND = 1000;
export const MEDIA_HTTP_OK = 200;
export const MEDIA_MAX_BYTES = 104_857_600;
export const MEDIA_ERROR_STATUS = {
  SETUP_NOT_READY: 503,
  INVALID_INPUT: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EXPIRED: 410,
  LIMIT_EXCEEDED: 409,
  INVALID_CONTENT: 422,
  UNAVAILABLE: 503,
  UNAUTHENTICATED: 401,
} as const;
export type MediaError = keyof typeof MEDIA_ERROR_STATUS;
export type MediaResult<T> =
  { ok: true; data: T } | { ok: false; code: MediaError };
export const mediaKindSchema = z.enum(['photo', 'voice', 'video']);
export type MediaKind = z.output<typeof mediaKindSchema>;
export const mediaMimeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/mpeg',
  'audio/mp4',
  'audio/webm',
  'video/mp4',
  'video/webm',
]);
export type MediaMime = z.output<typeof mediaMimeSchema>;
export const mediaBeginSchema = z.strictObject({
  requestId: z.uuid(),
  messageId: z.uuid(),
  mimeType: mediaMimeSchema,
  byteSize: z.number().int().positive().max(MEDIA_MAX_BYTES),
});
export const mediaCompleteSchema = z.strictObject({ uploadId: z.uuid() });
export const mediaRevokeSchema = mediaCompleteSchema;
export const mediaReadSchema = z.strictObject({
  mediaId: z.uuid(),
  preview: z.boolean(),
});
export type MediaBeginInput = z.output<typeof mediaBeginSchema>;
export type MediaUploadGrant = {
  uploadId: string;
  uploadUrl: string;
  expiresAt: string;
};
export type MediaReadGrant = {
  url: string;
  expiresAt: string;
  kind: MediaKind;
  mimeType: MediaMime;
};
