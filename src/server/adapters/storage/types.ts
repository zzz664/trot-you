import type { MediaKind, MediaMime } from '@/config/media';

export type StorageResult<T> =
  { ok: true; data: T } | { ok: false; code: 'INVALID_MEDIA' | 'UNAVAILABLE' };
export type VerifiedMedia = {
  bytes: Uint8Array;
  mimeType: MediaMime;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
};
export type MediaVerificationInput = {
  kind: MediaKind;
  mimeType: MediaMime;
  maxBytes: number;
  maxDurationMs: number | null;
};
export type MediaVerifier = (
  bytes: Uint8Array,
  input: MediaVerificationInput,
) => Promise<StorageResult<VerifiedMedia>>;
export type StoragePort = {
  signUpload(path: string): Promise<StorageResult<{ signedUrl: string }>>;
  downloadQuarantine(
    path: string,
    maxBytes: number,
  ): Promise<StorageResult<Uint8Array>>;
  publish(
    path: string,
    bytes: Uint8Array,
    mimeType: MediaMime,
  ): Promise<StorageResult<{ objectId: string }>>;
  removeQuarantine(path: string): Promise<StorageResult<null>>;
  signRead(
    path: string,
    expiresInSeconds: number,
  ): Promise<StorageResult<{ signedUrl: string; expiresAt: string }>>;
};
