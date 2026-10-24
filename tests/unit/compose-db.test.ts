// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createComposePort } from '@/server/db/artist-compose';
import type { ActorClient } from '@/server/db/client';
const id = 'a3000000-0000-4000-8000-000000000001';
const operationId = 'a3000000-0000-4000-8000-000000000002';
const slug = 'fictional-star';
const stamp = '2026-10-24T00:00:00.123456+00:00';
const draft = {
  id,
  kind: 'text',
  body: '안녕하세요',
  revision: 1,
  updated_at: stamp,
  media: [],
  pending_upload_ids: [],
  author_id: 'private',
  object_path: 'private',
};
const mapped = {
  id,
  kind: 'text',
  body: '안녕하세요',
  revision: 1,
  updatedAt: stamp,
  media: [],
  pendingUploadIds: [],
};
const artist = { id, slug, name: '가상 가수' };
const policy = {
  max_text_length: 1000,
  max_photo_count: 10,
  max_voice_seconds: 180,
  max_video_seconds: 60,
  photo_max_bytes: 10485760,
  voice_max_bytes: 20971520,
  video_max_bytes: 104857600,
  call_name_min_length: 2,
  call_name_max_length: 10,
};
const page = {
  artist,
  policy,
  drafts: [draft],
  selected_draft: draft,
  has_more: false,
};
function client(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { rpc, port: createComposePort({ rpc } as unknown as ActorClient) };
}
describe('actor-bound composer DB adapter', () => {
  it('uses exact actor RPC without a caller identity and strips private draft columns', async () => {
    const { port, rpc } = client(page);
    const result = await port.context(slug, id, { slug, id, updatedAt: stamp });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.selectedDraft).toEqual(mapped);
    expect(JSON.stringify(result)).not.toContain('private');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('artist_compose_context', {
      p_artist_slug: slug,
      p_message_id: id,
      p_before_updated_at: stamp,
      p_before_id: id,
    });
  });
  it('omits optional cursor and message', async () => {
    const { port, rpc } = client(page);
    await port.context(slug, null, null);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('artist_compose_context', {
      p_artist_slug: slug,
    });
  });
  it('projects assigned artists and omitted pagination only', async () => {
    const { port, rpc } = client({ artists: [artist], has_more: true });
    expect(await port.artists(null)).toEqual({
      ok: true,
      data: { artists: [artist], hasMore: true },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('artist_compose_artists', {});
    await port.artists(slug);
    expect(rpc).toHaveBeenLastCalledWith('artist_compose_artists', {
      p_after_slug: slug,
    });
  });
  it('binds save to stable message, operation, revision and exact media set', async () => {
    const { port, rpc } = client(draft);
    expect(
      await port.save({
        slug,
        messageId: id,
        operationId,
        expectedRevision: 0,
        kind: 'text',
        body: draft.body,
        mediaIds: [],
      }),
    ).toEqual({ ok: true, data: mapped });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('artist_compose_save', {
      p_artist_slug: slug,
      p_message_id: id,
      p_operation_id: operationId,
      p_expected_revision: 0,
      p_type: 'text',
      p_body: draft.body,
      p_media_ids: [],
    });
  });
  it('omits a nullable caption for the genuine optional SQL argument type', async () => {
    const { port, rpc } = client({ ...draft, kind: 'photo', body: null });
    await port.save({
      slug,
      messageId: id,
      operationId,
      expectedRevision: 0,
      kind: 'photo',
      body: null,
      mediaIds: [],
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('artist_compose_save', {
      p_artist_slug: slug,
      p_message_id: id,
      p_operation_id: operationId,
      p_expected_revision: 0,
      p_type: 'photo',
      p_media_ids: [],
    });
  });
  it('binds removal to logical resource and revision without any Storage delete', async () => {
    const { port, rpc } = client(draft);
    await port.remove({
      slug,
      messageId: id,
      mediaId: operationId,
      operationId,
      expectedRevision: 1,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('artist_compose_remove_media', {
      p_artist_slug: slug,
      p_message_id: id,
      p_media_id: operationId,
      p_operation_id: operationId,
      p_expected_revision: 1,
    });
  });
  it.each([
    null,
    {},
    [],
    { ...draft, revision: 0 },
    { ...draft, pending_upload_ids: ['path'] },
    {
      ...draft,
      media: [{ id, kind: 'photo', width: 1, height: 1, duration_ms: null }],
    },
  ])('fails malformed write projection closed %j', async (data) => {
    const { port } = client(data);
    expect(
      await port.save({
        slug,
        messageId: id,
        operationId,
        expectedRevision: 0,
        kind: 'text',
        body: draft.body,
        mediaIds: [],
      }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it.each([
    ['COMPOSE_FORBIDDEN', 'FORBIDDEN'],
    ['COMPOSE_OPERATION_CONFLICT', 'IDEMPOTENCY_CONFLICT'],
    ['COMPOSE_REVISION_CONFLICT', 'CONFLICT'],
    ['COMPOSE_MEDIA_CONFLICT', 'CONFLICT'],
    ['COMPOSE_NOT_DRAFT', 'CONFLICT'],
    ['COMPOSE_NOT_FOUND', 'NOT_FOUND'],
    ['COMPOSE_SETUP_NOT_READY', 'SETUP_NOT_READY'],
    ['private raw database detail', 'UNAVAILABLE'],
  ])('maps %s to %s without SQL leakage', async (message, code) => {
    const { port } = client(null, { message });
    expect(await port.artists(null)).toEqual({ ok: false, code });
  });
});
