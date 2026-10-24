// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createMediaDbPort } from '@/server/db/media';
import type { MediaServiceClient } from '@/server/db/media-client';
import { MEDIA_MAX_BYTES } from '@/config/media';

const id = (n: number) =>
  `ca120000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorId = id(1);
const artistId = id(2);
const messageId = id(3);
const uploadId = id(4);
const mediaId = id(5);
const requestId = id(6);
const objectId = id(7);
const upload = {
  upload_id: uploadId,
  media_id: mediaId,
  artist_id: artistId,
  message_id: messageId,
  state: 'pending',
  kind: 'photo',
  mime_type: 'image/png',
  byte_size: 50,
  quarantine_path: `${artistId}/${messageId}/${uploadId}.png`,
  object_path: `${artistId}/${messageId}/${mediaId}.png`,
  expires_at: '2026-10-24T18:00:00Z',
  max_bytes: 100,
  max_count: 10,
  max_duration_ms: null,
};
const read = {
  media_id: mediaId,
  message_id: messageId,
  kind: 'photo',
  mime_type: 'image/png',
  byte_size: 50,
  width: 10,
  height: 20,
  duration_ms: null,
  object_path: upload.object_path,
  bucket_id: 'message-media',
  access_expires_at: '2026-10-24T18:00:00Z',
};
const begin = {
  requestId,
  messageId,
  mimeType: 'image/png' as const,
  byteSize: 50,
};
function client(data: unknown = null, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    rpc,
    port: createMediaDbPort({ rpc } as unknown as MediaServiceClient),
  };
}

describe('resource-only media database adapter', () => {
  it('binds begin to verified actor and caller idempotency/resource declarations only', async () => {
    const { rpc, port } = client(upload);
    expect(await port.begin(actorId, begin)).toEqual({
      ok: true,
      data: upload,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('media_begin_upload', {
      p_actor_id: actorId,
      p_message_id: messageId,
      p_mime_type: 'image/png',
      p_byte_size: 50,
      p_request_id: requestId,
    });
  });
  it('resolves by actor and upload ID, not by a caller path', async () => {
    const { rpc, port } = client(upload);
    expect(await port.resolve(actorId, uploadId)).toEqual({
      ok: true,
      data: upload,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('media_resolve_upload', {
      p_actor_id: actorId,
      p_upload_id: uploadId,
    });
  });
  it.each([true, false])(
    'reads with the explicit preview=%s scope and server actor',
    async (preview) => {
      const { rpc, port } = client(read);
      expect(await port.read(actorId, mediaId, preview)).toEqual({
        ok: true,
        data: read,
      });
      expect(rpc).toHaveBeenCalledExactlyOnceWith('media_resolve_read', {
        p_actor_id: actorId,
        p_media_id: mediaId,
        p_preview: preview,
      });
    },
  );
  it.each([
    { width: 10, height: 20, durationMs: null },
    { width: null, height: null, durationMs: 180_000 },
    { width: 10, height: 20, durationMs: 60_000 },
  ])(
    'forwards verified metadata including actual null dimensions/duration %#',
    async (metadata) => {
      const { rpc, port } = client(mediaId);
      expect(
        await port.finalize(actorId, uploadId, objectId, metadata),
      ).toEqual({ ok: true, data: mediaId });
      expect(rpc).toHaveBeenCalledExactlyOnceWith('media_finalize_upload', {
        p_actor_id: actorId,
        p_upload_id: uploadId,
        p_storage_object_id: objectId,
        p_width: metadata.width,
        p_height: metadata.height,
        p_duration_ms: metadata.durationMs,
      });
    },
  );
  it('maps only a true revoke response to success and never exposes the boolean', async () => {
    const { rpc, port } = client(true);
    expect(await port.revoke(actorId, uploadId)).toEqual({
      ok: true,
      data: null,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('media_revoke_upload', {
      p_actor_id: actorId,
      p_upload_id: uploadId,
    });
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await port.revoke(actorId, uploadId)).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
  });
  it.each([null, 'true', 1, {}, { revoked: true }])(
    'rejects a malformed revoke result %#',
    async (data) => {
      expect(await client(data).port.revoke(actorId, uploadId)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
  it.each([null, '', 'private/path', true, { mediaId }, [mediaId]])(
    'rejects malformed completion scalar %#',
    async (data) => {
      expect(
        await client(data).port.finalize(actorId, uploadId, objectId, {
          width: 10,
          height: 20,
          durationMs: null,
        }),
      ).toEqual({ ok: false, code: 'UNAVAILABLE' });
    },
  );
  it('whitelists internal DTO fields and strips unexpected account, credential or URL data', async () => {
    const forbidden = {
      actor_secret: 'private-credential',
      email: 'private@example.invalid',
      signed_url: 'https://private.invalid?token=secret',
    };
    const beginResult = await client({ ...upload, ...forbidden }).port.begin(
      actorId,
      begin,
    );
    expect(beginResult).toEqual({ ok: true, data: upload });
    const readResult = await client({ ...read, ...forbidden }).port.read(
      actorId,
      mediaId,
      true,
    );
    expect(readResult).toEqual({ ok: true, data: read });
    expect(JSON.stringify([beginResult, readResult])).not.toContain(
      'private-credential',
    );
  });
  it('preserves completed idempotency after a current policy byte cap shrinks', async () => {
    const data = { ...upload, state: 'completed', max_bytes: 1 };
    expect(await client(data).port.resolve(actorId, uploadId)).toEqual({
      ok: true,
      data,
    });
  });
  it.each([
    null,
    {},
    [],
    { ...upload, upload_id: 'not-uuid' },
    { ...upload, media_id: uploadId, object_path: upload.quarantine_path },
    { ...upload, artist_id: id(9) },
    { ...upload, message_id: id(9) },
    { ...upload, state: 'ready' },
    { ...upload, kind: 'text' },
    { ...upload, mime_type: 'image/svg+xml' },
    { ...upload, kind: 'voice', max_duration_ms: 180_000 },
    { ...upload, byte_size: 0 },
    { ...upload, byte_size: 1.5 },
    { ...upload, byte_size: 101 },
    {
      ...upload,
      byte_size: MEDIA_MAX_BYTES + 1,
      max_bytes: MEDIA_MAX_BYTES + 1,
    },
    { ...upload, byte_size: '50' },
    { ...upload, max_bytes: 0 },
    { ...upload, max_count: 0 },
    { ...upload, max_duration_ms: 1 },
    { ...upload, expires_at: 'later' },
    { ...upload, quarantine_path: `../${upload.quarantine_path}` },
    { ...upload, quarantine_path: upload.object_path },
    { ...upload, object_path: upload.quarantine_path },
    { ...upload, object_path: `${artistId}/${messageId}/${mediaId}.jpg` },
    { ...upload, object_path: `https://evil.invalid/${upload.object_path}` },
    { ...upload, object_path: upload.object_path.replace('/', '/%2f') },
  ])('fails closed on inconsistent upload projections %#', async (data) => {
    const { port } = client(data);
    expect(await port.begin(actorId, begin)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(await port.resolve(actorId, uploadId)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it.each([
    null,
    {},
    [],
    { ...read, media_id: id(9) },
    { ...read, message_id: id(9) },
    { ...read, kind: 'voice' },
    { ...read, mime_type: 'text/html' },
    { ...read, mime_type: 'image/jpeg' },
    { ...read, byte_size: 0 },
    { ...read, byte_size: -1 },
    { ...read, byte_size: 1.5 },
    { ...read, byte_size: MEDIA_MAX_BYTES + 1 },
    { ...read, byte_size: '50' },
    { ...read, width: null },
    { ...read, height: null },
    { ...read, width: -1 },
    { ...read, duration_ms: 1 },
    { ...read, access_expires_at: 'later' },
    { ...read, bucket_id: 'media-quarantine' },
    { ...read, bucket_id: 'avatars' },
    { ...read, object_path: `${artistId}/${messageId}/${mediaId}.svg` },
    {
      ...read,
      object_path: `${artistId}/${messageId}/${mediaId}.png?token=secret`,
    },
    { ...read, object_path: `/${read.object_path}` },
    { ...read, object_path: read.object_path.replace('/', '/%2f') },
  ])('fails closed on inconsistent read projections %#', async (data) => {
    expect(await client(data).port.read(actorId, mediaId, true)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it.each([
    {
      ...read,
      kind: 'voice',
      mime_type: 'audio/mp4',
      width: null,
      height: null,
      duration_ms: 180_000,
      object_path: `${artistId}/${messageId}/${mediaId}.m4a`,
    },
    {
      ...read,
      kind: 'video',
      mime_type: 'video/webm',
      width: 100,
      height: 200,
      duration_ms: 60_000,
      object_path: `${artistId}/${messageId}/${mediaId}.webm`,
    },
  ])('accepts type-consistent verified native media shape %#', async (data) => {
    expect(await client(data).port.read(actorId, mediaId, false)).toEqual({
      ok: true,
      data,
    });
  });
  it.each([
    ['MEDIA_FORBIDDEN', 'FORBIDDEN'],
    ['MESSAGE_AUTHOR_FORBIDDEN', 'FORBIDDEN'],
    ['MESSAGE_ARTIST_UNAVAILABLE', 'FORBIDDEN'],
    ['DISCOVERY_FORBIDDEN', 'FORBIDDEN'],
    ['DISCOVERY_PROFILE_REQUIRED', 'FORBIDDEN'],
    ['MEDIA_INPUT_INVALID', 'INVALID_INPUT'],
    ['MEDIA_TYPE_INVALID', 'INVALID_INPUT'],
    ['MEDIA_UPLOAD_CONFLICT', 'INVALID_INPUT'],
    ['MEDIA_DRAFT_REQUIRED', 'FORBIDDEN'],
    ['MEDIA_UPLOAD_REVOKED', 'FORBIDDEN'],
    ['MEDIA_UPLOAD_EXPIRED', 'EXPIRED'],
    ['MEDIA_LIMIT_EXCEEDED', 'LIMIT_EXCEEDED'],
    ['MEDIA_COUNT_EXCEEDED', 'LIMIT_EXCEEDED'],
    ['MEDIA_OBJECT_INVALID', 'INVALID_CONTENT'],
    ['MEDIA_NOT_FOUND', 'NOT_FOUND'],
    ['MEDIA_ACCESS_EXPIRED', 'EXPIRED'],
    ['MEDIA_NOT_AVAILABLE', 'FORBIDDEN'],
    ['MESSAGE_POLICY_REQUIRED', 'SETUP_NOT_READY'],
    ['DISCOVERY_SETUP_NOT_READY', 'SETUP_NOT_READY'],
    ['MEDIA_POLICY_REQUIRED', 'SETUP_NOT_READY'],
    ['MEDIA_FORBIDDEN: secret detail', 'UNAVAILABLE'],
    ['__proto__', 'UNAVAILABLE'],
    ['toString', 'UNAVAILABLE'],
    ['private path/token', 'UNAVAILABLE'],
  ])('maps only the exact database error %s to %s', async (message, code) => {
    const { port } = client(upload, {
      message,
      details: 'secret-error-details',
    });
    expect(await port.begin(actorId, begin)).toEqual({ ok: false, code });
    expect(await port.resolve(actorId, uploadId)).toEqual({ ok: false, code });
    expect(await port.read(actorId, mediaId, true)).toEqual({
      ok: false,
      code,
    });
    expect(
      await port.finalize(actorId, uploadId, objectId, {
        width: 1,
        height: 1,
        durationMs: null,
      }),
    ).toEqual({ ok: false, code });
    expect(await port.revoke(actorId, uploadId)).toEqual({ ok: false, code });
  });
  it.each(['raw secret', {}, { message: 1 }, { code: 'MEDIA_FORBIDDEN' }])(
    'does not infer authority from malformed errors %#',
    async (error) => {
      expect(
        await client(read, error).port.read(actorId, mediaId, true),
      ).toEqual({ ok: false, code: 'UNAVAILABLE' });
    },
  );
});
