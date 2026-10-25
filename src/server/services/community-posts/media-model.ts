import 'server-only';
import { z } from 'zod';
import {
  communityImageMimeSchema,
  type CommunityImageBegin,
} from '@/config/community-media';
import type { CommunityResult } from '@/config/community-posts';
import {
  STORAGE_BOARD_MAX_BYTES,
  STORAGE_BOARD_PATH_PATTERN,
  STORAGE_MIME_EXTENSIONS,
} from '@/config/storage';

const bytes = z.number().int().positive().max(STORAGE_BOARD_MAX_BYTES);
export const communityUploadSnapshotSchema = z
  .strictObject({
    upload_id: z.uuid(),
    image_id: z.uuid(),
    actor_id: z.uuid(),
    artist_id: z.uuid(),
    post_id: z.uuid(),
    mime_type: communityImageMimeSchema,
    byte_size: bytes,
    quarantine_path: z.string().regex(STORAGE_BOARD_PATH_PATTERN),
    object_path: z.string().regex(STORAGE_BOARD_PATH_PATTERN),
    expires_at: z.string().datetime({ offset: true }),
    state: z.enum(['pending', 'completed']),
    max_bytes: bytes,
    max_count: z.number().int().nonnegative(),
    max_long_edge: z.number().int().positive(),
  })
  .refine((v) => {
    const prefix = `${v.artist_id}/${v.post_id}/`;
    const extension = STORAGE_MIME_EXTENSIONS[v.mime_type];
    return (
      v.upload_id !== v.image_id &&
      v.quarantine_path === `${prefix}${v.upload_id}.${extension}` &&
      v.object_path === `${prefix}${v.image_id}.${extension}`
    );
  });
export const communityReadSnapshotSchema = z
  .strictObject({
    image_id: z.uuid(),
    post_id: z.uuid(),
    mime_type: communityImageMimeSchema,
    byte_size: bytes,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    object_path: z.string().regex(STORAGE_BOARD_PATH_PATTERN),
    bucket_id: z.literal('board-media'),
    access_expires_at: z.string().datetime({ offset: true }),
  })
  .refine((v) =>
    v.object_path.endsWith(
      `/${v.post_id}/${v.image_id}.${STORAGE_MIME_EXTENSIONS[v.mime_type]}`,
    ),
  );
export type CommunityUploadSnapshot = z.output<
  typeof communityUploadSnapshotSchema
>;
export type CommunityReadSnapshot = z.output<
  typeof communityReadSnapshotSchema
>;
export type CommunityMediaPort = {
  begin(
    actorId: string,
    input: CommunityImageBegin,
  ): Promise<CommunityResult<CommunityUploadSnapshot>>;
  resolve(
    actorId: string,
    uploadId: string,
  ): Promise<CommunityResult<CommunityUploadSnapshot>>;
  finalize(
    actorId: string,
    uploadId: string,
    objectId: string,
    metadata: { width: number; height: number },
  ): Promise<CommunityResult<string>>;
  revoke(actorId: string, uploadId: string): Promise<CommunityResult<null>>;
  read(
    actorId: string,
    imageId: string,
  ): Promise<CommunityResult<CommunityReadSnapshot>>;
};
