import { z } from 'zod';
import { STORAGE_BOARD_MAX_BYTES } from '@/config/storage';

export const COMMUNITY_MEDIA = {
  accept: 'image/jpeg,image/png,image/webp',
  urlMaxLength: 8192,
  bodyLimit: 2048,
  bodyTimeoutMs: 5000,
  requestTimeoutMs: 30_000,
  uploadTimeoutMs: 120_000,
  responseMaxBytes: 16_384,
  readTtlSeconds: 60,
  uploadLifetimeMs: 7_200_000,
  millisecondsPerSecond: 1000,
} as const;
export const communityImageMimeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
export const communityImageBeginSchema = z.strictObject({
  requestId: z.uuid(),
  artistId: z.uuid(),
  postId: z.uuid(),
  mimeType: communityImageMimeSchema,
  byteSize: z.number().int().positive().max(STORAGE_BOARD_MAX_BYTES),
});
export const communityImageUploadSchema = z.strictObject({
  uploadId: z.uuid(),
});
export const communityImageReadSchema = z.strictObject({
  imageId: z.uuid(),
  postId: z.uuid(),
});
export const communityImageGrantSchema = z.strictObject({
  uploadId: z.uuid(),
  uploadUrl: z.url().max(COMMUNITY_MEDIA.urlMaxLength),
  expiresAt: z.string().datetime({ offset: true }),
});
export const communityImageCompletionSchema = z.strictObject({
  imageId: z.uuid(),
});
export const communityImageReadGrantSchema = z.strictObject({
  url: z.url().max(COMMUNITY_MEDIA.urlMaxLength),
  expiresAt: z.string().datetime({ offset: true }),
  mimeType: communityImageMimeSchema,
});
export type CommunityImageBegin = z.output<typeof communityImageBeginSchema>;
export type CommunityImageGrant = z.output<typeof communityImageGrantSchema>;
export type CommunityImageReadGrant = z.output<
  typeof communityImageReadGrantSchema
>;
