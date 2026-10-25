import 'server-only';
import { z } from 'zod';
import {
  COMMUNITY_MEDIA,
  communityImageBeginSchema,
  communityImageUploadSchema,
  communityImageReadSchema,
  type CommunityImageGrant,
  type CommunityImageReadGrant,
} from '@/config/community-media';
import type { CommunityResult } from '@/config/community-posts';
import type {
  StoragePort,
  MediaVerifier,
  VerifiedMedia,
} from '@/server/adapters/storage/types';
import type {
  CommunityMediaPort,
  CommunityUploadSnapshot,
} from './media-model';

export type CommunityMediaDependencies = {
  db: CommunityMediaPort;
  storage: StoragePort;
  verify: MediaVerifier;
  now: () => number;
};
const unavailable = { ok: false, code: 'UNAVAILABLE' } as const;
const invalid = { ok: false, code: 'INVALID_INPUT' } as const;
const forbidden = { ok: false, code: 'FORBIDDEN' } as const;
const expired = { ok: false, code: 'EXPIRED' } as const;
function binding(
  snapshot: CommunityUploadSnapshot,
  actorId: string,
  uploadId: string,
) {
  return snapshot.actor_id === actorId && snapshot.upload_id === uploadId;
}
function sameIntent(a: CommunityUploadSnapshot, b: CommunityUploadSnapshot) {
  return (
    a.upload_id === b.upload_id &&
    a.image_id === b.image_id &&
    a.actor_id === b.actor_id &&
    a.artist_id === b.artist_id &&
    a.post_id === b.post_id &&
    a.mime_type === b.mime_type &&
    a.byte_size === b.byte_size &&
    a.quarantine_path === b.quarantine_path &&
    a.object_path === b.object_path &&
    a.expires_at === b.expires_at
  );
}
function live(snapshot: CommunityUploadSnapshot, now: number) {
  return Date.parse(snapshot.expires_at) > now;
}
function validPhoto(photo: VerifiedMedia, snapshot: CommunityUploadSnapshot) {
  return (
    photo.mimeType === snapshot.mime_type &&
    photo.width !== null &&
    photo.height !== null &&
    photo.width > 0 &&
    photo.height > 0 &&
    Number.isSafeInteger(photo.width) &&
    Number.isSafeInteger(photo.height) &&
    Math.max(photo.width, photo.height) <= snapshot.max_long_edge &&
    photo.durationMs === null &&
    photo.byteSize === photo.bytes.byteLength &&
    photo.byteSize > 0 &&
    photo.byteSize <= snapshot.max_bytes
  );
}
async function discard(
  deps: CommunityMediaDependencies,
  actorId: string,
  snapshot: CommunityUploadSnapshot,
) {
  await deps.db.revoke(actorId, snapshot.upload_id).catch(() => undefined);
  await deps.storage
    .removeQuarantine(snapshot.quarantine_path)
    .catch(() => undefined);
}
export async function beginCommunityImage(
  deps: CommunityMediaDependencies,
  actorId: string,
  input: unknown,
): Promise<CommunityResult<CommunityImageGrant>> {
  if (!z.uuid().safeParse(actorId).success) return forbidden;
  const parsed = communityImageBeginSchema.safeParse(input);
  if (!parsed.success) return invalid;
  try {
    const result = await deps.db.begin(actorId, parsed.data);
    if (!result.ok) return result;
    const snapshot = result.data;
    if (
      snapshot.actor_id !== actorId ||
      snapshot.artist_id !== parsed.data.artistId ||
      snapshot.post_id !== parsed.data.postId ||
      snapshot.mime_type !== parsed.data.mimeType ||
      snapshot.byte_size !== parsed.data.byteSize
    )
      return unavailable;
    if (!live(snapshot, deps.now()) || snapshot.state !== 'pending')
      return expired;
    const signed = await deps.storage.signUpload(snapshot.quarantine_path);
    if (!signed.ok) return unavailable;
    const current = await deps.db.resolve(actorId, snapshot.upload_id);
    if (!current.ok) return current;
    if (!sameIntent(snapshot, current.data)) return unavailable;
    if (!live(current.data, deps.now()) || current.data.state !== 'pending')
      return expired;
    if (
      snapshot.byte_size > current.data.max_bytes ||
      current.data.max_count < 1
    )
      return { ok: false, code: 'LIMIT_EXCEEDED' };
    return {
      ok: true,
      data: {
        uploadId: snapshot.upload_id,
        uploadUrl: signed.data.signedUrl,
        expiresAt: snapshot.expires_at,
      },
    };
  } catch {
    return unavailable;
  }
}
export async function completeCommunityImage(
  deps: CommunityMediaDependencies,
  actorId: string,
  input: unknown,
): Promise<CommunityResult<{ imageId: string }>> {
  if (!z.uuid().safeParse(actorId).success) return forbidden;
  const parsed = communityImageUploadSchema.safeParse(input);
  if (!parsed.success) return invalid;
  try {
    const result = await deps.db.resolve(actorId, parsed.data.uploadId);
    if (!result.ok) return result;
    const snapshot = result.data;
    if (!binding(snapshot, actorId, parsed.data.uploadId)) return unavailable;
    if (!live(snapshot, deps.now())) return expired;
    if (snapshot.state === 'completed')
      return { ok: true, data: { imageId: snapshot.image_id } };
    const download = await deps.storage.downloadQuarantine(
      snapshot.quarantine_path,
      Math.min(snapshot.byte_size, snapshot.max_bytes),
    );
    if (!download.ok) {
      if (download.code === 'INVALID_MEDIA') {
        await discard(deps, actorId, snapshot);
        return { ok: false, code: 'INVALID_CONTENT' };
      }
      return unavailable;
    }
    if (download.data.byteLength !== snapshot.byte_size) {
      await discard(deps, actorId, snapshot);
      return { ok: false, code: 'INVALID_CONTENT' };
    }
    const verified = await deps.verify(download.data, {
      kind: 'photo',
      mimeType: snapshot.mime_type,
      maxBytes: snapshot.max_bytes,
      maxDurationMs: null,
    });
    if (!verified.ok) {
      if (verified.code === 'INVALID_MEDIA')
        await discard(deps, actorId, snapshot);
      return {
        ok: false,
        code:
          verified.code === 'INVALID_MEDIA' ? 'INVALID_CONTENT' : 'UNAVAILABLE',
      };
    }
    if (!validPhoto(verified.data, snapshot)) {
      await discard(deps, actorId, snapshot);
      return { ok: false, code: 'INVALID_CONTENT' };
    }
    const current = await deps.db.resolve(actorId, snapshot.upload_id);
    if (!current.ok) return current;
    if (!sameIntent(snapshot, current.data)) return unavailable;
    if (!live(current.data, deps.now())) return expired;
    if (current.data.state === 'completed')
      return { ok: true, data: { imageId: current.data.image_id } };
    if (!validPhoto(verified.data, current.data) || current.data.max_count < 1)
      return { ok: false, code: 'LIMIT_EXCEEDED' };
    const stored = await deps.storage.publish(
      snapshot.object_path,
      verified.data.bytes,
      verified.data.mimeType,
    );
    if (!stored.ok) return unavailable;
    const completed = await deps.db.finalize(
      actorId,
      snapshot.upload_id,
      stored.data.objectId,
      { width: verified.data.width!, height: verified.data.height! },
    );
    if (!completed.ok) return completed;
    if (completed.data !== snapshot.image_id) return unavailable;
    await deps.storage
      .removeQuarantine(snapshot.quarantine_path)
      .catch(() => undefined);
    return { ok: true, data: { imageId: completed.data } };
  } catch {
    return unavailable;
  }
}
export async function revokeCommunityImage(
  deps: CommunityMediaDependencies,
  actorId: string,
  input: unknown,
): Promise<CommunityResult<null>> {
  if (!z.uuid().safeParse(actorId).success) return forbidden;
  const parsed = communityImageUploadSchema.safeParse(input);
  if (!parsed.success) return invalid;
  try {
    const snapshot = await deps.db.resolve(actorId, parsed.data.uploadId);
    const revoked = await deps.db.revoke(actorId, parsed.data.uploadId);
    if (!revoked.ok) return revoked;
    if (snapshot.ok && binding(snapshot.data, actorId, parsed.data.uploadId))
      await deps.storage
        .removeQuarantine(snapshot.data.quarantine_path)
        .catch(() => undefined);
    return { ok: true, data: null };
  } catch {
    return unavailable;
  }
}
export async function readCommunityImage(
  deps: CommunityMediaDependencies,
  actorId: string,
  input: unknown,
): Promise<CommunityResult<CommunityImageReadGrant>> {
  if (!z.uuid().safeParse(actorId).success) return forbidden;
  const parsed = communityImageReadSchema.safeParse(input);
  if (!parsed.success) return invalid;
  try {
    const result = await deps.db.read(actorId, parsed.data.imageId);
    if (!result.ok) return result;
    const snapshot = result.data;
    if (
      snapshot.image_id !== parsed.data.imageId ||
      snapshot.post_id !== parsed.data.postId
    )
      return unavailable;
    const seconds = Math.min(
      COMMUNITY_MEDIA.readTtlSeconds,
      Math.floor(
        (Date.parse(snapshot.access_expires_at) - deps.now()) /
          COMMUNITY_MEDIA.millisecondsPerSecond,
      ),
    );
    if (seconds < 1) return expired;
    const signed = await deps.storage.signRead(snapshot.object_path, seconds);
    if (!signed.ok) return unavailable;
    const current = await deps.db.read(actorId, parsed.data.imageId);
    if (!current.ok) return current;
    const expiresAt = Date.parse(signed.data.expiresAt);
    if (
      !Number.isFinite(expiresAt) ||
      expiresAt > Date.parse(current.data.access_expires_at) ||
      expiresAt <= deps.now()
    )
      return expired;
    if (
      current.data.image_id !== snapshot.image_id ||
      current.data.post_id !== snapshot.post_id ||
      current.data.object_path !== snapshot.object_path ||
      current.data.mime_type !== snapshot.mime_type
    )
      return unavailable;
    return {
      ok: true,
      data: {
        url: signed.data.signedUrl,
        expiresAt: new Date(expiresAt).toISOString(),
        mimeType: snapshot.mime_type,
      },
    };
  } catch {
    return unavailable;
  }
}
