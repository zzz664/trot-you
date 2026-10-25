// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readArtistReplyActivityPage,
  readArtistReplyActivityMessages,
  readArtistReplyActivityArtists,
} from '@/server/services/artist-reply-activity/activity';
import {
  activityIds as ids,
  activityPage,
  activityMessages,
  activitySlug as slug,
  activityStamp as stamp,
} from './activity-domain-fixtures';
const port = { context: vi.fn(), messages: vi.fn(), artists: vi.fn() };
function rawPage() {
  const { nextCursor: _, ...raw } = activityPage();
  void _;
  return raw;
}
function rawMessages() {
  const { nextCursor: _, ...raw } = activityMessages();
  void _;
  return raw;
}
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
beforeEach(() => {
  vi.resetAllMocks();
  port.context.mockResolvedValue({ ok: true, data: rawPage() });
  port.messages.mockResolvedValue({ ok: true, data: rawMessages() });
  port.artists.mockResolvedValue({
    ok: true,
    data: { artists: [activityPage().artist], hasMore: false },
  });
});
describe('safe artist reply/activity services', () => {
  it('passes no actor or private fan selector and returns source activity', async () => {
    expect(
      await readArtistReplyActivityPage(port, { slug, messageId: null }),
    ).toEqual({ ok: true, data: activityPage() });
    expect(port.context).toHaveBeenCalledExactlyOnceWith(slug, null, null);
  });
  it('preserves microseconds and binds feed cursor to artist/message/scope', async () => {
    port.context.mockResolvedValue({
      ok: true,
      data: { ...rawPage(), hasMore: true },
    });
    const result = await readArtistReplyActivityPage(port, {
      slug,
      messageId: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('missing');
    const cursor = result.data.nextCursor!;
    expect(JSON.parse(Buffer.from(cursor, 'base64url').toString())).toEqual({
      kind: 'replies',
      slug,
      messageId: null,
      createdAt: stamp,
      id: ids.reply,
    });
    port.context.mockResolvedValue({
      ok: true,
      data: { ...rawPage(), replies: [] },
    });
    await readArtistReplyActivityPage(port, { slug, messageId: null, cursor });
    expect(port.context).toHaveBeenLastCalledWith(slug, null, {
      kind: 'replies',
      slug,
      messageId: null,
      createdAt: stamp,
      id: ids.reply,
    });
    expect(
      await readArtistReplyActivityPage(port, {
        slug,
        messageId: ids.message,
        cursor,
      }),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(
      await readArtistReplyActivityPage(port, {
        slug: 'other-artist',
        messageId: null,
        cursor,
      }),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(
      await readArtistReplyActivityMessages(port, { slug, cursor }),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  });
  it.each([
    {},
    { slug },
    { slug, messageId: null, fanId: ids.other },
    { slug: '../artist', messageId: null },
    { slug, messageId: 'bad' },
    { slug, messageId: null, cursor: '' },
    { slug, messageId: null, cursor: '=' },
    {
      slug,
      messageId: null,
      cursor: encode({
        kind: 'replies',
        slug,
        messageId: null,
        createdAt: stamp,
        id: ids.reply,
        extra: 'no',
      }),
    },
  ])('rejects invalid input without database read: %j', async (input) => {
    expect(await readArtistReplyActivityPage(port, input)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(port.context).not.toHaveBeenCalled();
  });
  it.each([
    { artist: { ...activityPage().artist, slug: 'wrong' } },
    { selectedMessage: activityMessages().messages[0] },
    { hasMore: true, replies: [] },
    { replies: [...activityPage().replies, ...activityPage().replies] },
    { replies: [{ ...activityPage().replies[0], userId: ids.other }] },
    { activity: { ...activityPage().activity, photoCount: 5 } },
    { activity: { ...activityPage().activity, requirementsReady: false } },
  ])('rejects unsafe or mismatched successful result: %j', async (changes) => {
    port.context.mockResolvedValue({
      ok: true,
      data: { ...rawPage(), ...changes },
    });
    expect(
      await readArtistReplyActivityPage(port, { slug, messageId: null }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('accepts selected sent message and exact matching linked replies', async () => {
    port.context.mockResolvedValue({
      ok: true,
      data: { ...rawPage(), selectedMessage: activityMessages().messages[0] },
    });
    expect(
      (
        await readArtistReplyActivityPage(port, {
          slug,
          messageId: ids.message,
        })
      ).ok,
    ).toBe(true);
    expect(
      (await readArtistReplyActivityPage(port, { slug, messageId: ids.other }))
        .ok,
    ).toBe(false);
    port.context.mockResolvedValue({
      ok: true,
      data: {
        ...rawPage(),
        selectedMessage: activityMessages().messages[0],
        replies: [{ ...activityPage().replies[0], messageId: null }],
      },
    });
    expect(
      (
        await readArtistReplyActivityPage(port, {
          slug,
          messageId: ids.message,
        })
      ).ok,
    ).toBe(false);
  });
  it('represents unapproved contract as null, never documented draft defaults', async () => {
    const page = {
      ...rawPage(),
      activity: {
        ...activityPage().activity,
        requirementsReady: false,
        weeklyMessageMin: null,
        weeklyPhotoMin: null,
      },
    };
    port.context.mockResolvedValue({ ok: true, data: page });
    expect(
      await readArtistReplyActivityPage(port, { slug, messageId: null }),
    ).toEqual({ ok: true, data: { ...page, nextCursor: null } });
  });
  it('paginates messages without truncating filtering to latest30', async () => {
    port.messages.mockResolvedValue({
      ok: true,
      data: { ...rawMessages(), hasMore: true },
    });
    const result = await readArtistReplyActivityMessages(port, { slug });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('missing');
    expect(
      JSON.parse(Buffer.from(result.data.nextCursor!, 'base64url').toString()),
    ).toEqual({ kind: 'messages', slug, sentAt: stamp, id: ids.message });
    expect(
      await readArtistReplyActivityMessages(port, {
        slug,
        cursor: result.data.nextCursor!,
      }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it.each([
    { artist: { ...activityPage().artist, slug: 'other' } },
    { messages: [], hasMore: true },
    {
      messages: [
        ...activityMessages().messages,
        ...activityMessages().messages,
      ],
    },
  ])('rejects mismatched message page %j', async (changes) => {
    port.messages.mockResolvedValue({
      ok: true,
      data: { ...rawMessages(), ...changes },
    });
    expect(await readArtistReplyActivityMessages(port, { slug })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('paginates owned artist catalog and rejects duplicates/nonadvancing results', async () => {
    port.artists.mockResolvedValue({
      ok: true,
      data: { artists: [activityPage().artist], hasMore: true },
    });
    expect(await readArtistReplyActivityArtists(port, null)).toEqual({
      ok: true,
      data: { artists: [activityPage().artist], hasMore: true, nextSlug: slug },
    });
    expect(await readArtistReplyActivityArtists(port, slug)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    port.artists.mockResolvedValue({
      ok: true,
      data: { artists: [], hasMore: true },
    });
    expect((await readArtistReplyActivityArtists(port, null)).ok).toBe(false);
  });
  it.each([
    'FORBIDDEN',
    'NOT_FOUND',
    'UNAVAILABLE',
    'SETUP_NOT_READY',
  ] as const)('retains defined failure %s without fallback', async (code) => {
    port.context.mockResolvedValue({ ok: false, code });
    port.messages.mockResolvedValue({ ok: false, code });
    port.artists.mockResolvedValue({ ok: false, code });
    expect(
      await readArtistReplyActivityPage(port, { slug, messageId: null }),
    ).toEqual({ ok: false, code });
    expect(await readArtistReplyActivityMessages(port, { slug })).toEqual({
      ok: false,
      code,
    });
    expect(await readArtistReplyActivityArtists(port, null)).toEqual({
      ok: false,
      code,
    });
  });
  it('catches database failures without private output', async () => {
    for (const method of Object.values(port))
      method.mockRejectedValue(new Error('private data'));
    expect(
      await readArtistReplyActivityPage(port, { slug, messageId: null }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(await readArtistReplyActivityMessages(port, { slug })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(await readArtistReplyActivityArtists(port, null)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});
