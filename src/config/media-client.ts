import { z } from 'zod';
import { mediaKindSchema, mediaMimeSchema } from './media';

// Browser-only transport ceilings. The server owns quotas and byte validation.
export const MEDIA_CLIENT_UPLOAD_TIMEOUT_MS = 120_000;
export const MEDIA_CLIENT_URL_MAX_LENGTH = 8_192;
export const MEDIA_CLIENT_UPLOAD_LIFETIME_MS = 7_200_000;

export const mediaUploadGrantSchema = z.strictObject({
  uploadId: z.uuid(),
  uploadUrl: z.string().url().max(MEDIA_CLIENT_URL_MAX_LENGTH),
  expiresAt: z.iso.datetime({ offset: true }),
});
export const mediaReadGrantSchema = z.strictObject({
  url: z.string().url().max(MEDIA_CLIENT_URL_MAX_LENGTH),
  expiresAt: z.iso.datetime({ offset: true }),
  kind: mediaKindSchema,
  mimeType: mediaMimeSchema,
});
export const mediaCompletionSchema = z.strictObject({ mediaId: z.uuid() });
