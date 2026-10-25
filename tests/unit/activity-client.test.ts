import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readArtistReplyActivityPage,
  readArtistReplyActivityMessages,
} from '@/client/artist-reply-activity';
import {
  ACTIVITY_ERROR_STATUS,
  ACTIVITY_RESPONSE_MAX_BYTES,
} from '@/config/artist-reply-activity';
import {
  artistReplyActivityApiPath,
  artistReplyActivityPath,
  artistReplyActivityMenuPath,
  routes,
} from '@/config/routes';
import {
  activityIds as ids,
  activityPage,
  activityMessages,
  activitySlug as slug,
} from './activity-domain-fixtures';
const fetchMock = vi.fn();
function respond(body: unknown, status = 200, type = 'application/json') {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': type },
    }),
  );
}
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  respond({ ok: true, data: activityPage() });
});
afterEach(() => vi.unstubAllGlobals());
describe('artist reply/activity browser read contract', () => {
  it('posts bounded same-origin private read without caller identity', async () => {
    expect(
      await readArtistReplyActivityPage({ slug, messageId: null }),
    ).toEqual({ ok: true, data: activityPage() });
    const [path, options] = fetchMock.mock.calls[0]!;
    expect(path).toBe(artistReplyActivityApiPath(slug));
    expect(options).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(options.body)).toEqual({ messageId: null });
  });
  it('uses separate paginated message filter endpoint', async () => {
    respond({ ok: true, data: activityMessages() });
    expect(
      await readArtistReplyActivityMessages({ slug, cursor: 'opaque' }),
    ).toEqual({ ok: true, data: activityMessages() });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      artistReplyActivityApiPath(slug, 'messages'),
    );
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      cursor: 'opaque',
    });
  });
  it('does not perform invalid or already aborted reads', async () => {
    const abort = new AbortController();
    abort.abort();
    expect(
      await readArtistReplyActivityPage(
        { slug, messageId: null },
        abort.signal,
      ),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(
      await readArtistReplyActivityPage({ slug: '../bad', messageId: null }),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(await readArtistReplyActivityMessages({ slug, cursor: '' })).toEqual(
      { ok: false, code: 'INVALID_INPUT' },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(Object.entries(ACTIVITY_ERROR_STATUS))(
    'binds %s to exact HTTP status',
    async (code, status) => {
      respond({ ok: false, code }, status);
      expect(
        await readArtistReplyActivityPage({ slug, messageId: null }),
      ).toEqual({ ok: false, code });
      respond({ ok: false, code });
      expect(
        await readArtistReplyActivityPage({ slug, messageId: null }),
      ).toEqual({ ok: false, code: 'UNAVAILABLE' });
    },
  );
  it.each([
    { artist: { ...activityPage().artist, slug: 'other-artist' } },
    { replies: [{ ...activityPage().replies[0], userId: ids.other }] },
    {
      replies: [
        { ...activityPage().replies[0], email: 'private@example.test' },
      ],
    },
    { replies: [...activityPage().replies, ...activityPage().replies] },
    { selectedMessage: activityMessages().messages[0]! },
    { hasMore: true, nextCursor: null },
    { hasMore: false, nextCursor: 'opaque' },
    { hasMore: true, replies: [], nextCursor: 'opaque' },
  ])(
    'rejects mismatched or private-contaminated response %j',
    async (changes) => {
      respond({ ok: true, data: { ...activityPage(), ...changes } });
      expect(
        await readArtistReplyActivityPage({ slug, messageId: null }),
      ).toEqual({ ok: false, code: 'UNAVAILABLE' });
    },
  );
  it('binds filtered reply result to exact source message', async () => {
    respond({
      ok: true,
      data: activityPage({ selectedMessage: activityMessages().messages[0]! }),
    });
    expect(
      (await readArtistReplyActivityPage({ slug, messageId: ids.message })).ok,
    ).toBe(true);
    respond({
      ok: true,
      data: activityPage({ selectedMessage: activityMessages().messages[0]! }),
    });
    expect(
      (await readArtistReplyActivityPage({ slug, messageId: ids.other })).ok,
    ).toBe(false);
    respond({
      ok: true,
      data: activityPage({
        selectedMessage: activityMessages().messages[0]!,
        replies: [{ ...activityPage().replies[0]!, messageId: null }],
      }),
    });
    expect(
      (await readArtistReplyActivityPage({ slug, messageId: ids.message })).ok,
    ).toBe(false);
  });
  it('rejects repeated cursor without append loop', async () => {
    respond({
      ok: true,
      data: activityPage({ hasMore: true, nextCursor: 'opaque' }),
    });
    expect(
      await readArtistReplyActivityPage({
        slug,
        messageId: null,
        cursor: 'opaque',
      }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it.each([
    { artist: { ...activityMessages().artist, slug: 'wrong' } },
    {
      messages: [
        ...activityMessages().messages,
        ...activityMessages().messages,
      ],
    },
    { messages: [], hasMore: true, nextCursor: 'opaque' },
    { hasMore: true, nextCursor: null },
  ])('rejects invalid message picker response %j', async (changes) => {
    respond({ ok: true, data: activityMessages(changes) });
    expect(await readArtistReplyActivityMessages({ slug })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it.each([
    null,
    [],
    { ok: true },
    { ok: false, code: 'PRIVATE_ERROR' },
    { ok: true, data: activityPage(), secret: 'no' },
  ])('rejects malformed envelope %j', async (body) => {
    respond(body);
    expect(
      await readArtistReplyActivityPage({ slug, messageId: null }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('rejects invalid content type, non200 success and failed transport', async () => {
    respond({ ok: true, data: activityPage() }, 200, 'text/html');
    expect(
      (await readArtistReplyActivityPage({ slug, messageId: null })).ok,
    ).toBe(false);
    respond({ ok: true, data: activityPage() }, 503);
    expect(
      (await readArtistReplyActivityPage({ slug, messageId: null })).ok,
    ).toBe(false);
    fetchMock.mockRejectedValue(new Error('private'));
    expect(
      (await readArtistReplyActivityPage({ slug, messageId: null })).ok,
    ).toBe(false);
  });
  it('accepts a full page of maximum-length multibyte reply bodies', async () => {
    const body = '🌸'.repeat(10_000);
    const replies = Array.from({ length: 30 }, (_, index) => ({
      ...activityPage().replies[0]!,
      id: `a5000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      body,
    }));
    const page = activityPage({ replies });
    expect(
      new TextEncoder().encode(JSON.stringify(page)).byteLength,
    ).toBeGreaterThan(1_048_576);
    respond({ ok: true, data: page });
    expect(
      await readArtistReplyActivityPage({ slug, messageId: null }),
    ).toEqual({ ok: true, data: page });
  });
  it('caps reply bytes and fails closed on invalid UTF8', async () => {
    fetchMock.mockResolvedValue(
      new Response(' '.repeat(ACTIVITY_RESPONSE_MAX_BYTES + 1), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(
      (await readArtistReplyActivityPage({ slug, messageId: null })).ok,
    ).toBe(false);
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([255]), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(
      (await readArtistReplyActivityPage({ slug, messageId: null })).ok,
    ).toBe(false);
  });
  it('constructs centralized escaped URLs for menu/filter/cursor', () => {
    expect(artistReplyActivityMenuPath()).toBe(routes.artistReplyActivityMenu);
    expect(artistReplyActivityMenuPath('next')).toBe(
      `${routes.artistReplyActivityMenu}?after=next`,
    );
    expect(artistReplyActivityPath(slug, ids.message, 'opaque')).toBe(
      `/artist/${slug}/replies?message=${ids.message}&cursor=opaque`,
    );
    expect(artistReplyActivityPath(slug)).toBe(`/artist/${slug}/replies`);
  });
});
