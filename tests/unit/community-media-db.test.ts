// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createCommunityMediaPort } from '@/server/db/community-media';
import type { MediaServiceClient } from '@/server/db/media-client';
import { STORAGE_BOARD_MAX_BYTES } from '@/config/storage';
const actor = 'd0340000-0000-4000-8000-000000000001';
const artist = 'd0340000-0000-4000-8000-000000000002';
const post = 'd0340000-0000-4000-8000-000000000003';
const upload = 'd0340000-0000-4000-8000-000000000004';
const image = 'd0340000-0000-4000-8000-000000000005';
const object = 'd0340000-0000-4000-8000-000000000006';
const operation = 'd0340000-0000-4000-8000-000000000007';
const snapshot = {
  upload_id: upload,
  image_id: image,
  actor_id: actor,
  artist_id: artist,
  post_id: post,
  mime_type: 'image/png' as const,
  byte_size: 3,
  quarantine_path: `${artist}/${post}/${upload}.png`,
  object_path: `${artist}/${post}/${image}.png`,
  expires_at: '2026-10-25T12:00:00Z',
  state: 'pending',
  max_bytes: 1000,
  max_count: 3,
  max_long_edge: 100,
};
const read = {
  image_id: image,
  post_id: post,
  mime_type: 'image/png' as const,
  byte_size: 3,
  width: 2,
  height: 2,
  object_path: snapshot.object_path,
  bucket_id: 'board-media',
  access_expires_at: '2026-10-25T10:01:00Z',
};
const input = {
  requestId: operation,
  artistId: artist,
  postId: post,
  mimeType: 'image/png' as const,
  byteSize: 3,
};
function fixture(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    rpc,
    port: createCommunityMediaPort({ rpc } as unknown as MediaServiceClient),
  };
}
it('begins a server-authorized draft reservation with exact actor/request/type/size mapping', async () => {
  const f = fixture(snapshot);
  expect(await f.port.begin(actor, input)).toEqual({
    ok: true,
    data: snapshot,
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('board_media_begin_upload', {
    p_actor_id: actor,
    p_artist_id: artist,
    p_post_id: post,
    p_mime_type: 'image/png',
    p_byte_size: 3,
    p_request_id: operation,
  });
});
it('resolves only actor-owned upload identity', async () => {
  const f = fixture({ ...snapshot, state: 'completed' });
  expect(await f.port.resolve(actor, upload)).toEqual({
    ok: true,
    data: { ...snapshot, state: 'completed' },
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('board_media_resolve_upload', {
    p_actor_id: actor,
    p_upload_id: upload,
  });
});
it('finalizes verified storage object and measured integer dimensions through one RPC', async () => {
  const f = fixture(image);
  expect(
    await f.port.finalize(actor, upload, object, { width: 2, height: 3 }),
  ).toEqual({ ok: true, data: image });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('board_media_finalize_upload', {
    p_actor_id: actor,
    p_upload_id: upload,
    p_storage_object_id: object,
    p_width: 2,
    p_height: 3,
  });
});
it('revoke confirms the database boolean instead of manufacturing success', async () => {
  const f = fixture(true);
  expect(await f.port.revoke(actor, upload)).toEqual({ ok: true, data: null });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('board_media_revoke_upload', {
    p_actor_id: actor,
    p_upload_id: upload,
  });
  expect(await fixture(false).port.revoke(actor, upload)).toEqual({
    ok: false,
    code: 'FORBIDDEN',
  });
});
it('read resolves authorized image metadata without accepting client paths or buckets', async () => {
  const f = fixture(read);
  expect(await f.port.read(actor, image)).toEqual({ ok: true, data: read });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('board_media_resolve_read', {
    p_actor_id: actor,
    p_image_id: image,
  });
});
it.each([
  ['COMMUNITY_FORBIDDEN', 'FORBIDDEN'],
  ['COMMUNITY_SERVICE_REQUIRED', 'FORBIDDEN'],
  ['COMMUNITY_BOARD_UNAVAILABLE', 'NOT_FOUND'],
  ['COMMUNITY_TARGET_UNAVAILABLE', 'NOT_FOUND'],
  ['COMMUNITY_POLICY_REQUIRED', 'SETUP_NOT_READY'],
  ['COMMUNITY_POLICY_INVALID', 'SETUP_NOT_READY'],
  ['COMMUNITY_IMAGE_INVALID', 'INVALID_CONTENT'],
  ['COMMUNITY_IMAGE_LIMIT', 'LIMIT_EXCEEDED'],
  ['COMMUNITY_IDEMPOTENCY_CONFLICT', 'CONFLICT'],
  ['COMMUNITY_REQUEST_REQUIRED', 'INVALID_INPUT'],
  ['BOARD_INVALID_INPUT', 'INVALID_INPUT'],
  ['BOARD_ISOLATION_UNSUPPORTED', 'UNAVAILABLE'],
  ['BOARD_OPERATION_CONFLICT', 'CONFLICT'],
  ['BOARD_IMAGE_INVALID', 'INVALID_CONTENT'],
  ['BOARD_IMAGE_LIMIT', 'LIMIT_EXCEEDED'],
  ['BOARD_UPLOAD_EXPIRED', 'EXPIRED'],
  ['BOARD_UPLOAD_REVOKED', 'FORBIDDEN'],
  ['BOARD_MEDIA_INVALID', 'INVALID_INPUT'],
  ['BOARD_MEDIA_EXPIRED', 'EXPIRED'],
  ['BOARD_MEDIA_REVOKED', 'FORBIDDEN'],
  ['BOARD_MEDIA_NOT_FOUND', 'NOT_FOUND'],
  ['BOARD_MEDIA_CONFLICT', 'CONFLICT'],
  ['BOARD_MEDIA_LIMIT', 'LIMIT_EXCEEDED'],
  ['private SQL diagnostic', 'UNAVAILABLE'],
  ['toString', 'UNAVAILABLE'],
  ['constructor', 'UNAVAILABLE'],
  ['__proto__', 'UNAVAILABLE'],
])(
  'maps exact %s error without SQL/credential disclosure',
  async (message, code) => {
    const f = fixture(null, { message });
    for (const result of await Promise.all([
      f.port.begin(actor, input),
      f.port.resolve(actor, upload),
      f.port.finalize(actor, upload, object, { width: 2, height: 3 }),
      f.port.revoke(actor, upload),
      f.port.read(actor, image),
    ]))
      expect(result).toEqual({ ok: false, code });
  },
);
it.each([
  true,
  123,
  {},
  [],
  { message: null },
  { message: 12 },
  { details: 'private service credential' },
])('contains malformed RPC error %#', async (error) =>
  expect(await fixture(null, error).port.begin(actor, input)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  }),
);
it.each([
  null,
  [],
  {},
  { ...snapshot, upload_id: image },
  { ...snapshot, actor_id: 'bad' },
  { ...snapshot, state: 'revoked' },
  { ...snapshot, quarantine_path: `${artist}/${post}/${image}.png` },
  { ...snapshot, object_path: `${artist}/${post}/${upload}.png` },
  { ...snapshot, mime_type: 'image/jpeg' },
  { ...snapshot, mime_type: 'audio/mpeg' },
  { ...snapshot, byte_size: 0 },
  { ...snapshot, byte_size: STORAGE_BOARD_MAX_BYTES + 1 },
  { ...snapshot, max_count: -1 },
  { ...snapshot, max_long_edge: 0 },
  { ...snapshot, expires_at: 'infinity' },
  { ...snapshot, service_role_key: 'private' },
  { ...snapshot, bucket_id: 'board-media' },
])('fails closed on malformed upload snapshot %#', async (data) => {
  const f = fixture(data);
  expect(await f.port.begin(actor, input)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
  expect(await f.port.resolve(actor, upload)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('policy change to zero image quota remains explicit rather than rewritten to fallback', async () =>
  expect(
    await fixture({ ...snapshot, max_count: 0 }).port.resolve(actor, upload),
  ).toEqual({ ok: true, data: { ...snapshot, max_count: 0 } }));
it.each([
  null,
  [],
  {},
  { ...read, image_id: 'bad' },
  { ...read, post_id: object },
  { ...read, bucket_id: 'message-media' },
  { ...read, object_path: `${artist}/${post}/${upload}.png` },
  { ...read, mime_type: 'image/jpeg' },
  { ...read, byte_size: 0 },
  { ...read, byte_size: STORAGE_BOARD_MAX_BYTES + 1 },
  { ...read, width: 0 },
  { ...read, height: 0 },
  { ...read, height: 1.5 },
  { ...read, access_expires_at: 'infinity' },
  { ...read, service_role_key: 'private' },
  { ...read, upload_url: 'private' },
])('fails closed on malformed read snapshot %#', async (data) =>
  expect(await fixture(data).port.read(actor, image)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  }),
);
it.each([null, {}, false, 1, 'not-uuid', { id: image }])(
  'does not fabricate finalization receipt %#',
  async (data) =>
    expect(
      await fixture(data).port.finalize(actor, upload, object, {
        width: 2,
        height: 3,
      }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' }),
);
it.each([null, {}, 1, 'true', []])(
  'does not fabricate revoke confirmation %#',
  async (data) =>
    expect(await fixture(data).port.revoke(actor, upload)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    }),
);
