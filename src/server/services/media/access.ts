import 'server-only';
import { z } from 'zod';
import {
  MEDIA_MILLISECONDS_PER_SECOND,
  MEDIA_READ_TTL_SECONDS,
  mediaBeginSchema,
  mediaCompleteSchema,
  mediaReadSchema,
  mediaRevokeSchema,
  type MediaReadGrant,
  type MediaResult,
  type MediaUploadGrant,
} from '@/config/media';
import type {
  StoragePort,
  MediaVerifier,
} from '@/server/adapters/storage/types';
import type { MediaDbPort, MediaUploadSnapshot } from './model';

export type MediaDependencies = {
  db: MediaDbPort;
  storage: StoragePort;
  verify: MediaVerifier;
  now: () => number;
};
const unavailable = { ok: false, code: 'UNAVAILABLE' } as const;
const invalid = { ok: false, code: 'INVALID_INPUT' } as const;
const forbidden = { ok: false, code: 'FORBIDDEN' } as const;
function expired(snapshot: MediaUploadSnapshot, now: number) {
  return (
    snapshot.state !== 'completed' &&
    (snapshot.state !== 'pending' || Date.parse(snapshot.expires_at) <= now)
  );
}
async function discard(
  deps: MediaDependencies,
  actorId: string,
  snapshot: MediaUploadSnapshot,
) {
  // Best-effort cleanup cannot turn invalid bytes into success. A failed revoke
  // or delete remains unreadable quarantine, never registered message media.
  await deps.db.revoke(actorId, snapshot.upload_id).catch(() => undefined);
  await deps.storage
    .removeQuarantine(snapshot.quarantine_path)
    .catch(() => undefined);
}
export async function beginMediaUpload(
  deps: MediaDependencies,
  actorId: string,
  input: unknown,
): Promise<MediaResult<MediaUploadGrant>> {
  if (!z.uuid().safeParse(actorId).success) return forbidden;
  const parsed = mediaBeginSchema.safeParse(input);
  if (!parsed.success) return invalid;
  try {
    const result = await deps.db.begin(actorId, parsed.data);
    if (!result.ok) return result;
    const snapshot = result.data;
    if (expired(snapshot, deps.now()) || snapshot.state === 'completed')
      return { ok: false, code: 'EXPIRED' };
    const signed = await deps.storage.signUpload(snapshot.quarantine_path);
    if (!signed.ok) return unavailable;
    // Do not disclose a newly signed capability after membership/restriction or
    // draft state was revoked while Storage was responding.
    const current = await deps.db.resolve(actorId, snapshot.upload_id);
    if (!current.ok) return current;
    if (expired(current.data, deps.now()) || current.data.state !== 'pending')
      return { ok: false, code: 'EXPIRED' };
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
export async function completeMediaUpload(
  deps: MediaDependencies,
  actorId: string,
  input: unknown,
): Promise<MediaResult<{ mediaId: string }>> {
  if (!z.uuid().safeParse(actorId).success) return forbidden;
  const parsed = mediaCompleteSchema.safeParse(input);
  if (!parsed.success) return invalid;
  try {
    const result = await deps.db.resolve(actorId, parsed.data.uploadId);
    if (!result.ok) return result;
    const snapshot = result.data;
    if (snapshot.state === 'completed')
      return { ok: true, data: { mediaId: snapshot.media_id } };
    if (expired(snapshot, deps.now())) return { ok: false, code: 'EXPIRED' };
    const download = await deps.storage.downloadQuarantine(
      snapshot.quarantine_path,
      Math.min(snapshot.byte_size, snapshot.max_bytes),
    );
    if (!download.ok)
      return download.code === 'INVALID_MEDIA'
        ? (await discard(deps, actorId, snapshot),
          { ok: false, code: 'INVALID_CONTENT' })
        : unavailable;
    if (download.data.byteLength !== snapshot.byte_size) {
      await discard(deps, actorId, snapshot);
      return { ok: false, code: 'INVALID_CONTENT' };
    }
    const verified = await deps.verify(download.data, {
      kind: snapshot.kind,
      mimeType: snapshot.mime_type,
      maxBytes: snapshot.max_bytes,
      maxDurationMs: snapshot.max_duration_ms,
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
    const current = await deps.db.resolve(actorId, snapshot.upload_id);
    if (!current.ok) return current;
    if (current.data.state === 'completed')
      return { ok: true, data: { mediaId: current.data.media_id } };
    if (expired(current.data, deps.now()))
      return { ok: false, code: 'EXPIRED' };
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
      verified.data,
    );
    if (!completed.ok) return completed;
    await deps.storage
      .removeQuarantine(snapshot.quarantine_path)
      .catch(() => undefined);
    return { ok: true, data: { mediaId: completed.data } };
  } catch {
    return unavailable;
  }
}
export async function revokeMediaUpload(
  deps: MediaDependencies,
  actorId: string,
  input: unknown,
): Promise<MediaResult<null>> {
  if (!z.uuid().safeParse(actorId).success) return forbidden;
  const parsed = mediaRevokeSchema.safeParse(input);
  if (!parsed.success) return invalid;
  try {
    const snapshot = await deps.db.resolve(actorId, parsed.data.uploadId);
    // resolve is only a best-effort cleanup hint. The revoke RPC independently
    // checks ownership, and permits replay after resolve would reject a revoked
    // or expired intent. Never use this hint to decide mutation authority.
    const revoked = await deps.db.revoke(actorId, parsed.data.uploadId);
    if (!revoked.ok) return revoked;
    if (snapshot.ok)
      await deps.storage
        .removeQuarantine(snapshot.data.quarantine_path)
        .catch(() => undefined);
    return { ok: true, data: null };
  } catch {
    return unavailable;
  }
}
export async function readMediaUrl(
  deps: MediaDependencies,
  actorId: string,
  input: unknown,
): Promise<MediaResult<MediaReadGrant>> {
  if (!z.uuid().safeParse(actorId).success) return forbidden;
  const parsed = mediaReadSchema.safeParse(input);
  if (!parsed.success) return invalid;
  try {
    const result = await deps.db.read(
      actorId,
      parsed.data.mediaId,
      parsed.data.preview,
    );
    if (!result.ok) return result;
    const snapshot = result.data;
    const issuedAt = deps.now();
    const seconds = Math.min(
      MEDIA_READ_TTL_SECONDS,
      Math.floor(
        (Date.parse(snapshot.access_expires_at) - issuedAt) /
          MEDIA_MILLISECONDS_PER_SECOND,
      ),
    );
    if (seconds < 1) return { ok: false, code: 'EXPIRED' };
    const signed = await deps.storage.signRead(snapshot.object_path, seconds);
    if (!signed.ok) return unavailable;
    const current = await deps.db.read(
      actorId,
      parsed.data.mediaId,
      parsed.data.preview,
    );
    if (!current.ok) return current;
    // Storage starts its token clock when it signs, not when we requested it.
    // Client-side expiry cannot shorten a bearer capability. Reject (do not
    // disclose) a grant whose actual provider expiry crosses current access.
    const expiresAt = Date.parse(signed.data.expiresAt);
    if (
      !Number.isFinite(expiresAt) ||
      expiresAt > Date.parse(current.data.access_expires_at)
    )
      return { ok: false, code: 'EXPIRED' };
    if (expiresAt <= deps.now()) return { ok: false, code: 'EXPIRED' };
    if (
      current.data.object_path !== snapshot.object_path ||
      current.data.mime_type !== snapshot.mime_type
    )
      return unavailable;
    return {
      ok: true,
      data: {
        url: signed.data.signedUrl,
        expiresAt: new Date(expiresAt).toISOString(),
        kind: snapshot.kind,
        mimeType: snapshot.mime_type,
      },
    };
  } catch {
    return unavailable;
  }
}
