// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  readComposeArtists,
  readComposeContext,
  saveComposeDraft,
  removeComposeMedia,
  previewComposeDraft,
  type ComposePort,
} from '@/server/services/artist-compose/compose';
import { COMPOSE_ERROR_STATUS } from '@/config/artist-compose';
const slug = 'fictional-star';
const id = 'a3000000-0000-4000-8000-000000000001';
const operationId = 'a3000000-0000-4000-8000-000000000002';
const mediaId = 'a3000000-0000-4000-8000-000000000003';
const stamp = '2026-10-24T01:02:03.123456+00:00';
const draft = {
  id,
  kind: 'text' as const,
  body: '{이름} 님, 안녕하세요 💜',
  revision: 1,
  updatedAt: stamp,
  media: [],
  pendingUploadIds: [],
};
const artist = { id, slug, name: '가상 가수' };
const policy = {
  maxTextLength: 1000,
  maxPhotoCount: 10,
  maxVoiceSeconds: 180,
  maxVideoSeconds: 60,
  photoMaxBytes: 10485760,
  voiceMaxBytes: 20971520,
  videoMaxBytes: 104857600,
  callNameMinLength: 2,
  callNameMaxLength: 10,
};
const page = {
  artist,
  policy,
  drafts: [draft],
  selectedDraft: null,
  hasMore: false,
};
const input = {
  slug,
  messageId: id,
  operationId,
  expectedRevision: 0,
  kind: 'text' as const,
  body: draft.body,
  mediaIds: [],
};
function port() {
  const p = {
    artists: vi.fn().mockResolvedValue({
      ok: true,
      data: { artists: [artist], hasMore: false },
    }),
    context: vi.fn().mockResolvedValue({ ok: true, data: page }),
    save: vi.fn().mockResolvedValue({ ok: true, data: draft }),
    remove: vi
      .fn()
      .mockResolvedValue({ ok: true, data: { ...draft, revision: 2 } }),
  };
  return p satisfies ComposePort;
}
describe('artist draft service', () => {
  it('reads assigned artists and bounds cursor', async () => {
    const p = port();
    expect(await readComposeArtists(p)).toEqual({
      ok: true,
      data: { artists: [artist], hasMore: false, nextSlug: null },
    });
    p.artists.mockResolvedValue({
      ok: true,
      data: { artists: [artist], hasMore: true },
    });
    expect(await readComposeArtists(p)).toEqual({
      ok: true,
      data: { artists: [artist], hasMore: true, nextSlug: slug },
    });
    expect((await readComposeArtists(p, '!')).ok).toBe(false);
    expect((await readComposeArtists(p, slug)).ok).toBe(false);
  });
  it('owns context slug/selected ID and preserves cursor microseconds', async () => {
    const p = port();
    p.context.mockResolvedValue({ ok: true, data: { ...page, hasMore: true } });
    const result = await readComposeContext(p, { slug, messageId: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await readComposeContext(p, {
      slug,
      messageId: null,
      cursor: result.data.nextCursor!,
    });
    expect(p.context).toHaveBeenLastCalledWith(slug, null, {
      slug,
      updatedAt: stamp,
      id,
    });
    expect(
      (
        await readComposeContext(p, {
          slug: 'other',
          messageId: null,
          cursor: result.data.nextCursor!,
        })
      ).ok,
    ).toBe(false);
    expect((await readComposeContext(p, { slug, messageId: id })).ok).toBe(
      false,
    );
  });
  it.each([
    '!',
    'e30',
    'YQ==',
    Buffer.from(
      JSON.stringify({ slug, updatedAt: stamp, id, actorId: id }),
    ).toString('base64url'),
  ])('rejects invalid cursor %s before DB', async (cursor) => {
    const p = port();
    expect(
      await readComposeContext(p, { slug, messageId: null, cursor }),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(p.context).not.toHaveBeenCalled();
  });
  it.each([
    { artist: { ...artist, slug: 'other' } },
    { selectedDraft: draft },
    { drafts: [draft, draft] },
    { hasMore: true, drafts: [] },
  ])('fails resource-incoherent context closed %j', async (change) => {
    const p = port();
    p.context.mockResolvedValue({ ok: true, data: { ...page, ...change } });
    expect(await readComposeContext(p, { slug, messageId: null })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('saves exact original payload without an authority-racy pre-read', async () => {
    const p = port();
    expect(await saveComposeDraft(p, input)).toEqual({ ok: true, data: draft });
    expect(p.save).toHaveBeenCalledExactlyOnceWith(input);
    expect(p.context).not.toHaveBeenCalled();
  });
  it.each([
    { actorId: id },
    { role: 'artist' },
    { mediaIds: [mediaId, mediaId] },
    { expectedRevision: -1 },
    { kind: 'sent' },
    { body: null },
    { body: '' },
    { body: '  \t\n' },
    { body: 'bad\u0000' },
    { body: '\ud800' },
  ])('rejects malformed save %j before port', async (change) => {
    const p = port();
    expect(await saveComposeDraft(p, { ...input, ...change })).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(p.save).not.toHaveBeenCalled();
  });
  it.each(['photo', 'voice', 'video'] as const)(
    'accepts captionless %s draft but does not dispatch',
    async (kind) => {
      const p = port();
      p.save.mockResolvedValue({
        ok: true,
        data: { ...draft, kind, body: null },
      });
      expect(
        (await saveComposeDraft(p, { ...input, kind, body: null })).ok,
      ).toBe(true);
      expect(p.context).not.toHaveBeenCalled();
    },
  );
  it.each([
    { id: mediaId },
    { kind: 'photo' },
    { body: 'changed' },
    { revision: 2 },
    {
      media: [
        { id: mediaId, kind: 'photo', width: 1, height: 1, durationMs: null },
      ],
    },
  ])('fails mismatched receipt %j closed', async (change) => {
    const p = port();
    p.save.mockResolvedValue({ ok: true, data: { ...draft, ...change } });
    expect(await saveComposeDraft(p, input)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('removes exact logical media and validates authoritative revision', async () => {
    const p = port();
    expect(
      await removeComposeMedia(p, {
        slug,
        messageId: id,
        mediaId,
        expectedRevision: 1,
        operationId,
      }),
    ).toEqual({ ok: true, data: { ...draft, revision: 2 } });
    p.remove.mockResolvedValue({ ok: true, data: draft });
    expect(
      await removeComposeMedia(p, {
        slug,
        messageId: id,
        mediaId,
        expectedRevision: 1,
        operationId,
      }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('personalizes only on server and preserves literal name bytes without HTML', async () => {
    const p = port();
    expect(
      await previewComposeDraft(p, {
        slug,
        messageId: null,
        kind: 'text',
        body: '{이름}/{이름}',
        sampleName: '$&<>',
      }),
    ).toEqual({ ok: true, data: { text: '$&<>/$&<>', sampleName: '$&<>' } });
    expect(p.context).toHaveBeenCalledExactlyOnceWith(slug, null, null);
  });
  it.each([
    'A',
    'abcdefghijk',
    ' 순자',
    '순자 ',
    '순\n자',
    '\ud800순',
    '\u0000순자',
  ])('rejects sample name %j', async (sampleName) => {
    expect(
      (
        await previewComposeDraft(port(), {
          slug,
          messageId: null,
          kind: 'text',
          body: '{이름}',
          sampleName,
        })
      ).ok,
    ).toBe(false);
  });
  it('counts astral characters by scalar policy not UTF16 units', async () => {
    const p = port();
    p.context.mockResolvedValue({
      ok: true,
      data: { ...page, policy: { ...policy, maxTextLength: 2 } },
    });
    expect(
      (
        await previewComposeDraft(p, {
          slug,
          messageId: null,
          kind: 'text',
          body: '💜💜',
          sampleName: '순자',
        })
      ).ok,
    ).toBe(true);
    expect(
      await previewComposeDraft(p, {
        slug,
        messageId: null,
        kind: 'text',
        body: '💜💜💜',
        sampleName: '순자',
      }),
    ).toEqual({ ok: false, code: 'TOO_LONG' });
  });
  it.each(Object.keys(COMPOSE_ERROR_STATUS))(
    'preserves known port error %s without content',
    async (code) => {
      const p = port();
      for (const key of ['artists', 'context', 'save', 'remove'] as const)
        p[key].mockResolvedValue({ ok: false, code });
      expect(await saveComposeDraft(p, input)).toEqual({ ok: false, code });
      expect(await readComposeContext(p, { slug, messageId: null })).toEqual({
        ok: false,
        code,
      });
      expect(await readComposeArtists(p)).toEqual({ ok: false, code });
      expect(
        await removeComposeMedia(p, {
          slug,
          messageId: id,
          mediaId,
          expectedRevision: 1,
          operationId,
        }),
      ).toEqual({ ok: false, code });
    },
  );
  it('contains thrown errors without logging content', async () => {
    const p = port();
    for (const key of ['artists', 'context', 'save', 'remove'] as const)
      p[key].mockRejectedValue(new Error('private draft'));
    expect(await saveComposeDraft(p, input)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(await readComposeContext(p, { slug, messageId: null })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(await readComposeArtists(p)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(
      await removeComposeMedia(p, {
        slug,
        messageId: id,
        mediaId,
        expectedRevision: 1,
        operationId,
      }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
});
