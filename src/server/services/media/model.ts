import 'server-only';
import { z } from 'zod';
import {
  MEDIA_MAX_BYTES,
  mediaKindSchema,
  mediaMimeSchema,
  type MediaBeginInput,
  type MediaResult,
  type MediaKind,
  type MediaMime,
} from '@/config/media';

import {
  STORAGE_OBJECT_PATH_PATTERN,
  STORAGE_MIME_EXTENSIONS,
} from '@/config/storage';

const objectPathSchema = z.string().regex(STORAGE_OBJECT_PATH_PATTERN);
function matchingKind(kind: MediaKind, mime: MediaMime) {
  return mime.startsWith(
    kind === 'photo' ? 'image/' : kind === 'voice' ? 'audio/' : 'video/',
  );
}
const byteSizeSchema = z.number().int().positive().max(MEDIA_MAX_BYTES);
export const mediaUploadSnapshotSchema = z
  .object({
    upload_id: z.uuid(),
    media_id: z.uuid(),
    artist_id: z.uuid(),
    message_id: z.uuid(),
    state: z.enum(['pending', 'completed', 'revoked']),
    kind: mediaKindSchema,
    mime_type: mediaMimeSchema,
    byte_size: byteSizeSchema,
    quarantine_path: objectPathSchema,
    object_path: objectPathSchema,
    expires_at: z.string().datetime({ offset: true }),
    max_bytes: byteSizeSchema,
    max_count: z.number().int().positive(),
    max_duration_ms: z.number().int().positive().nullable(),
  })
  .refine((value) => {
    const prefix = `${value.artist_id}/${value.message_id}/`;
    const extension = STORAGE_MIME_EXTENSIONS[value.mime_type];
    return (
      matchingKind(value.kind, value.mime_type) &&
      value.quarantine_path === `${prefix}${value.upload_id}.${extension}` &&
      value.object_path === `${prefix}${value.media_id}.${extension}` &&
      value.upload_id !== value.media_id &&
      (value.state === 'completed' || value.byte_size <= value.max_bytes) &&
      (value.kind === 'photo'
        ? value.max_duration_ms === null
        : value.max_duration_ms !== null)
    );
  });
export type MediaUploadSnapshot = z.output<typeof mediaUploadSnapshotSchema>;
export const mediaReadSnapshotSchema = z
  .object({
    media_id: z.uuid(),
    message_id: z.uuid(),
    kind: mediaKindSchema,
    mime_type: mediaMimeSchema,
    byte_size: byteSizeSchema,
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    duration_ms: z.number().int().positive().nullable(),
    object_path: objectPathSchema,
    bucket_id: z.literal('message-media'),
    access_expires_at: z.string().datetime({ offset: true }),
  })
  .refine(
    (value) =>
      matchingKind(value.kind, value.mime_type) &&
      value.object_path.endsWith(
        `/${value.message_id}/${value.media_id}.${STORAGE_MIME_EXTENSIONS[value.mime_type]}`,
      ) &&
      (value.kind === 'photo'
        ? value.width !== null &&
          value.height !== null &&
          value.duration_ms === null
        : value.kind === 'voice'
          ? value.width === null &&
            value.height === null &&
            value.duration_ms !== null
          : value.width !== null &&
            value.height !== null &&
            value.duration_ms !== null),
  );
export type MediaReadSnapshot = z.output<typeof mediaReadSnapshotSchema>;
export type MediaDbPort = {
  begin(
    actorId: string,
    input: MediaBeginInput,
  ): Promise<MediaResult<MediaUploadSnapshot>>;
  resolve(
    actorId: string,
    uploadId: string,
  ): Promise<MediaResult<MediaUploadSnapshot>>;
  finalize(
    actorId: string,
    uploadId: string,
    objectId: string,
    metadata: {
      width: number | null;
      height: number | null;
      durationMs: number | null;
    },
  ): Promise<MediaResult<string>>;
  revoke(actorId: string, uploadId: string): Promise<MediaResult<null>>;
  read(
    actorId: string,
    mediaId: string,
    preview: boolean,
  ): Promise<MediaResult<MediaReadSnapshot>>;
};
