// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ARTIST_SLUG_MAX_LENGTH } from '@/config/artists';
import { CHAT_MAX_PAGE_SIZE, CHAT_PAGE_SIZE } from '@/config/chat';
import {
  decodeChatCursor,
  encodeChatCursor,
  markChatRead,
  readChatPage,
  type ChatPagePort,
  type ChatReadPort,
  type RawChatPage,
} from '@/server/services/chat/read';

const actor = 'a1900000-0000-4000-8000-000000000001';
const messageId = 'a1900000-0000-4000-8000-000000000002';
const mediaId = 'a1900000-0000-4000-8000-000000000003';
const slug = 'fictional-star';
const sentAt = '2026-10-24T00:00:00.123456+00:00';
const readAt = '2026-10-24T00:00:01.654321+00:00';
const cursor = { slug, sentAt, id: messageId };
const raw: RawChatPage = {
  artist: { slug, name: '허구 가수', description: null },
  callName: '별님',
  hasAccess: true,
  messages: [
    {
      id: messageId,
      kind: 'photo',
      template: '{이름} 안녕, {이름}!',
      sentAt,
      readAt: null,
      media: [{ id: mediaId, kind: 'photo' }],
    },
  ],
  readCount: 0,
  hasMore: false,
};
const pagePort = (data: RawChatPage = raw): ChatPagePort => ({
  page: vi.fn().mockResolvedValue({ ok: true, data }),
});
const readPort = (): ChatReadPort => ({
  mark: vi.fn().mockResolvedValue({ ok: true, data: { readAt, readCount: 1 } }),
});
const encoded = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

describe('chat timestamp cursor codec', () => {
  it('preserves all PostgreSQL microseconds and binds the tuple to the artist', () => {
    expect(decodeChatCursor(encodeChatCursor(cursor), slug)).toEqual(cursor);
    expect(decodeChatCursor(encodeChatCursor(cursor), 'other-star')).toBeNull();
    expect(encodeChatCursor(cursor)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it.each([
    '',
    'not-json',
    '====',
    'e30=',
    encoded({}),
    encoded(null),
    encoded({ ...cursor, id: 'not-a-uuid' }),
    encoded({ ...cursor, sentAt: '2026-02-30T00:00:00Z' }),
    encoded({ ...cursor, sentAt: 'Infinity' }),
    encoded({ ...cursor, sentAt: '2026-10-24' }),
    encoded({ ...cursor, slug: '../artist' }),
    encoded({ ...cursor, forged: true }),
    Buffer.from([0xff, 0xfe]).toString('base64url'),
  ])('rejects malformed, noncanonical or extra-field cursor %s', (input) => {
    expect(decodeChatCursor(input, slug)).toBeNull();
  });
  it('accepts valid longest slugs without creating an unusable next-page cursor', async () => {
    const longSlug = 'a'.repeat(ARTIST_SLUG_MAX_LENGTH);
    const port = pagePort({
      ...raw,
      artist: { ...raw.artist, slug: longSlug },
      hasMore: true,
    });
    const first = await readChatPage(port, actor, { slug: longSlug });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('Expected fixture page');
    const next = await readChatPage(port, actor, {
      slug: longSlug,
      cursor: first.data.nextCursor,
    });
    expect(next.ok).toBe(true);
    expect(port.page).toHaveBeenLastCalledWith(
      actor,
      longSlug,
      CHAT_PAGE_SIZE,
      { slug: longSlug, sentAt, id: messageId },
    );
  });
});

describe('trusted fan-chat page service', () => {
  it('uses documented bounded first-page default and one server personalization routine', async () => {
    const port = pagePort();
    expect(await readChatPage(port, actor, { slug })).toEqual({
      ok: true,
      data: {
        artist: raw.artist,
        hasAccess: true,
        readCount: 0,
        nextCursor: null,
        messages: [
          {
            id: messageId,
            kind: 'photo',
            text: '별님 안녕, 별님!',
            sentAt,
            readAt: null,
            media: [{ id: mediaId, kind: 'photo', availability: 'available' }],
          },
        ],
      },
    });
    expect(port.page).toHaveBeenCalledExactlyOnceWith(
      actor,
      slug,
      CHAT_PAGE_SIZE,
      null,
    );
  });
  it('projects only explicit browser fields without raw name, templates, storage or actor metadata', async () => {
    const extra = {
      ...raw,
      actorId: actor,
      artist: { ...raw.artist, contract: 'private-contract' },
      messages: [
        {
          ...raw.messages[0]!,
          body: 'raw-body',
          authorId: actor,
          media: [
            {
              ...raw.messages[0]!.media[0]!,
              path: 'private/path',
              objectId: 'private-object',
            },
          ],
        },
      ],
    };
    const result = await readChatPage(pagePort(extra), actor, { slug });
    const serialized = JSON.stringify(result);
    for (const privateValue of [
      'callName',
      'template',
      'raw-body',
      'private/path',
      'private-object',
      'private-contract',
      actor,
    ])
      expect(serialized).not.toContain(privateValue);
    expect(result.ok && result.data.messages[0]?.text).toBe('별님 안녕, 별님!');
  });
  it.each(['$&', '<img src=x onerror=alert(1)>', '{이름}'])(
    'returns %s literally as text without second replacement or HTML interpretation',
    async (callName) => {
      const result = await readChatPage(pagePort({ ...raw, callName }), actor, {
        slug,
      });
      expect(result.ok && result.data.messages[0]?.text).toBe(
        `${callName} 안녕, ${callName}!`,
      );
    },
  );
  it('keeps a media-only message nullable and existing read evidence unchanged', async () => {
    const result = await readChatPage(
      pagePort({
        ...raw,
        readCount: 1,
        messages: [{ ...raw.messages[0]!, template: null, readAt }],
      }),
      actor,
      { slug },
    );
    expect(result).toMatchObject({
      ok: true,
      data: { readCount: 1, messages: [{ text: null, readAt }] },
    });
  });
  it('provides an exact oldest-returned tuple only when the database reports more', async () => {
    const port = pagePort({ ...raw, hasMore: true });
    const result = await readChatPage(port, actor, {
      slug,
      cursor: encodeChatCursor(cursor),
      limit: 1,
    });
    expect(port.page).toHaveBeenCalledExactlyOnceWith(actor, slug, 1, cursor);
    expect(result.ok && result.data.nextCursor).toBe(encodeChatCursor(cursor));
  });
  it('returns honest empty paid and nonpaid contexts without synthetic messages or counts', async () => {
    expect(
      await readChatPage(pagePort({ ...raw, messages: [] }), actor, { slug }),
    ).toMatchObject({
      ok: true,
      data: { hasAccess: true, messages: [], readCount: 0, nextCursor: null },
    });
    expect(
      await readChatPage(
        pagePort({ ...raw, hasAccess: false, readCount: 99, hasMore: true }),
        actor,
        { slug },
      ),
    ).toMatchObject({
      ok: true,
      data: { hasAccess: false, messages: [], readCount: 0, nextCursor: null },
    });
  });
  it.each([
    null,
    {},
    { slug: '' },
    { slug: 'Other-Star' },
    { slug: '../admin' },
    { slug, actorId: actor },
    { slug, hasAccess: true },
    { slug, limit: 0 },
    { slug, limit: CHAT_MAX_PAGE_SIZE + 1 },
    { slug, limit: 1.5 },
    { slug, limit: '30' },
    { slug, cursor: '' },
    { slug, cursor: 'not-json' },
    { slug, cursor: encodeChatCursor({ ...cursor, slug: 'other-star' }) },
  ])(
    'rejects invalid/forged caller input before any DB call %j',
    async (input) => {
      const port = pagePort();
      expect(await readChatPage(port, actor, input)).toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
      expect(port.page).not.toHaveBeenCalled();
    },
  );
  it('rejects a malformed verified subject before DB access', async () => {
    const port = pagePort();
    expect(await readChatPage(port, 'not-a-uuid', { slug })).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(port.page).not.toHaveBeenCalled();
  });
  it.each([
    { ...raw, artist: { ...raw.artist, slug: 'other-star' } },
    { ...raw, messages: [...raw.messages, ...raw.messages] },
    { ...raw, messages: [], hasMore: true },
  ])('fails closed on inconsistent trusted projection %j', async (value) => {
    expect(await readChatPage(pagePort(value), actor, { slug })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('does not expose rows beyond the caller-selected bound', async () => {
    const second = { ...raw.messages[0]!, id: mediaId };
    expect(
      await readChatPage(
        pagePort({ ...raw, messages: [...raw.messages, second] }),
        actor,
        { slug, limit: 1 },
      ),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it.each([
    'FORBIDDEN',
    'NOT_FOUND',
    'PROFILE_REQUIRED',
    'SETUP_NOT_READY',
    'SUBSCRIPTION_REQUIRED',
  ] as const)(
    'preserves database %s rather than fabricating preview or paid success',
    async (code) => {
      const port = pagePort();
      vi.mocked(port.page).mockResolvedValue({ ok: false, code });
      expect(await readChatPage(port, actor, { slug })).toEqual({
        ok: false,
        code,
      });
    },
  );
  it('redacts rejected transport and projection errors', async () => {
    const port = pagePort();
    vi.mocked(port.page).mockRejectedValue(new Error('private SQL'));
    expect(await readChatPage(port, actor, { slug })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});

describe('actor-scoped read receipt service', () => {
  it('forwards only artist/message identifiers and preserves idempotent authoritative evidence', async () => {
    const port = readPort();
    const first = await markChatRead(port, { slug, messageId });
    const second = await markChatRead(port, { slug, messageId });
    expect(first).toEqual({
      ok: true,
      data: { messageId, readAt, readCount: 1 },
    });
    expect(second).toEqual(first);
    expect(port.mark).toHaveBeenNthCalledWith(1, slug, messageId);
    expect(port.mark).toHaveBeenNthCalledWith(2, slug, messageId);
  });
  it.each([
    null,
    {},
    { slug, messageId: 'invalid' },
    { slug: 'Bad', messageId },
    { slug, messageId, actorId: actor },
    { slug, messageId, readAt },
    { slug, messageId, readCount: 99 },
  ])('denies forged read evidence or subject input %j', async (input) => {
    const port = readPort();
    expect(await markChatRead(port, input)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(port.mark).not.toHaveBeenCalled();
  });
  it('does not replace denial or failed write with a locally invented receipt', async () => {
    const port = readPort();
    vi.mocked(port.mark).mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    expect(await markChatRead(port, { slug, messageId })).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    vi.mocked(port.mark).mockRejectedValue(new Error('private-write-detail'));
    expect(await markChatRead(port, { slug, messageId })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});
