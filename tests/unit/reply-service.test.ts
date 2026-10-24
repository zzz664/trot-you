// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  REPLY_ERROR_STATUS,
  REPLY_MAX_BODY_LENGTH,
  type OwnReply,
} from '@/config/replies';
import {
  decodeReplyCursor,
  encodeReplyCursor,
  readReplyPage,
  sendReply,
  type ReplyPort,
} from '@/server/services/replies/replies';

const slug = 'fictional-star';
const id = 'a2000000-0000-4000-8000-000000000001';
const operationId = 'a2000000-0000-4000-8000-000000000002';
const messageId = 'a2000000-0000-4000-8000-000000000003';
const createdAt = '2026-10-24T01:02:03.123456+00:00';
const reply: OwnReply = {
  id,
  operationId,
  messageId: null,
  body: '고맙습니다 💜',
  blocked: false,
  createdAt,
};
const input = { slug, operationId, messageId: null, body: reply.body! };
function port(): ReplyPort & {
  page: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
} {
  return {
    page: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        slug,
        sendReady: true,
        maxLength: 100,
        replies: [reply],
        hasMore: false,
      },
    }),
    send: vi.fn().mockResolvedValue({ ok: true, data: reply }),
  };
}
describe('reply service own-feed projection', () => {
  it('paginates using exact timestamp and UUID without rounding database precision', async () => {
    const p = port();
    p.page.mockResolvedValue({
      ok: true,
      data: {
        slug,
        sendReady: true,
        maxLength: 100,
        replies: [reply],
        hasMore: true,
      },
    });
    const result = await readReplyPage(p, { slug, limit: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(decodeReplyCursor(result.data.nextCursor!, slug)).toEqual({
      slug,
      createdAt,
      id,
    });
    await readReplyPage(p, { slug, cursor: result.data.nextCursor! });
    expect(p.page).toHaveBeenLastCalledWith(slug, 30, { slug, createdAt, id });
  });
  it('preserves no-policy own history but does not enable send', async () => {
    const p = port();
    p.page.mockResolvedValue({
      ok: true,
      data: {
        slug,
        sendReady: false,
        maxLength: 100,
        replies: [reply],
        hasMore: false,
      },
    });
    expect(await readReplyPage(p, { slug })).toEqual({
      ok: true,
      data: {
        slug,
        sendReady: false,
        maxLength: 100,
        replies: [reply],
        nextCursor: null,
      },
    });
  });
  it('preserves blocked rows as content-free owner history, not missing pagination entries', async () => {
    const p = port();
    const blocked = { ...reply, blocked: true, body: null };
    p.page.mockResolvedValue({
      ok: true,
      data: {
        slug,
        sendReady: true,
        maxLength: 100,
        replies: [blocked],
        hasMore: true,
      },
    });
    expect(await readReplyPage(p, { slug })).toMatchObject({
      ok: true,
      data: { replies: [blocked], nextCursor: expect.any(String) },
    });
  });
  it.each([
    null,
    {},
    { slug: 'Bad' },
    { slug, limit: 0 },
    { slug, limit: 101 },
    { slug, limit: 1.1 },
    { slug, cursor: '' },
    { slug, actorId: id },
    { slug, cursor: '!!' },
    { slug, cursor: encodeReplyCursor({ slug: 'other-star', createdAt, id }) },
  ])('rejects malformed page input %j before I/O', async (value) => {
    const p = port();
    expect(await readReplyPage(p, value)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(p.page).not.toHaveBeenCalled();
  });
  it.each([
    { slug: 'other-star' },
    { maxLength: 0 },
    { maxLength: REPLY_MAX_BODY_LENGTH + 1 },
    { sendReady: null },
    { replies: [], hasMore: true },
    { replies: [reply, reply] },
    { replies: [{ ...reply, body: null }] },
    { replies: [{ ...reply, blocked: true }] },
    { replies: [{ ...reply, createdAt: 'not-time' }] },
    { replies: [{ ...reply, id: 'bad' }] },
  ])(
    'fails malformed/cross-room/duplicate output closed %j',
    async (change) => {
      const p = port();
      p.page.mockResolvedValue({
        ok: true,
        data: {
          slug,
          maxLength: 100,
          sendReady: true,
          replies: [reply],
          hasMore: false,
          ...change,
        },
      });
      expect(await readReplyPage(p, { slug })).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
  it('rejects more rows than requested', async () => {
    const p = port();
    p.page.mockResolvedValue({
      ok: true,
      data: {
        slug,
        maxLength: 100,
        sendReady: true,
        replies: [reply, { ...reply, id: messageId }],
        hasMore: false,
      },
    });
    expect(await readReplyPage(p, { slug, limit: 1 })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it.each(Object.keys(REPLY_ERROR_STATUS))(
    'propagates %s without retry',
    async (code) => {
      const p = port();
      p.page.mockResolvedValue({ ok: false, code });
      expect(await readReplyPage(p, { slug })).toEqual({ ok: false, code });
      expect(p.page).toHaveBeenCalledTimes(1);
    },
  );
  it('maps thrown I/O to unavailable', async () => {
    const p = port();
    p.page.mockRejectedValue(new Error('private'));
    expect(await readReplyPage(p, { slug })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});
describe('reply cursor', () => {
  it('round-trips its complete room-bound tuple', () => {
    const cursor = { slug, createdAt, id };
    expect(decodeReplyCursor(encodeReplyCursor(cursor), slug)).toEqual(cursor);
  });
  it.each([
    '=',
    'a',
    'a+b',
    '____',
    Buffer.from('{}').toString('base64url'),
    Buffer.from(JSON.stringify({ slug, createdAt, id, actorId: id })).toString(
      'base64url',
    ),
    Buffer.from(
      JSON.stringify({ slug, createdAt: '2026-02-30T00:00:00Z', id }),
    ).toString('base64url'),
  ])('rejects noncanonical/malformed %s', (value) =>
    expect(decodeReplyCursor(value, slug)).toBeNull(),
  );
});
describe('reply write service', () => {
  it('passes immutable exact payload to actor-bound atomic port once', async () => {
    const p = port();
    expect(await sendReply(p, input)).toEqual({
      ok: true,
      data: { slug, reply },
    });
    expect(p.send).toHaveBeenCalledExactlyOnceWith(
      slug,
      operationId,
      input.body,
      null,
    );
  });
  it('binds a target message when supplied', async () => {
    const p = port();
    p.send.mockResolvedValue({ ok: true, data: { ...reply, messageId } });
    expect(await sendReply(p, { ...input, messageId })).toMatchObject({
      ok: true,
      data: { reply: { messageId } },
    });
  });
  it('replays the same operation explicitly without making up a new ID', async () => {
    const p = port();
    await sendReply(p, input);
    await sendReply(p, input);
    expect(p.send.mock.calls[0]).toEqual(p.send.mock.calls[1]);
  });
  it('accepts a replay redacted by moderation without echoing the draft body', async () => {
    const p = port();
    p.send.mockResolvedValue({
      ok: true,
      data: { ...reply, body: null, blocked: true },
    });
    expect(await sendReply(p, input)).toEqual({
      ok: true,
      data: { slug, reply: { ...reply, body: null, blocked: true } },
    });
  });
  it.each([
    null,
    {},
    { ...input, slug: 'Bad' },
    { ...input, operationId: 'bad' },
    { ...input, messageId: 'bad' },
    { ...input, messageId: undefined },
    { ...input, userId: id },
    { ...input, body: '' },
    { ...input, body: ' \n\t ' },
    { ...input, body: 'a\u0000b' },
    { ...input, body: 'a\u0007b' },
    { ...input, body: 'a\u007fb' },
    { ...input, body: '\ud800' },
    { ...input, body: '가'.repeat(REPLY_MAX_BODY_LENGTH + 1) },
  ])('rejects invalid/owner-forging input without I/O %j', async (value) => {
    const p = port();
    expect(await sendReply(p, value)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(p.send).not.toHaveBeenCalled();
  });
  it('counts astral text as PostgreSQL characters, not UTF-16 code units', async () => {
    const p = port();
    const body = '💜'.repeat(REPLY_MAX_BODY_LENGTH);
    p.send.mockResolvedValue({ ok: true, data: { ...reply, body } });
    expect(await sendReply(p, { ...input, body })).toMatchObject({ ok: true });
  });
  it.each([
    { operationId: id },
    { messageId },
    { body: 'changed' },
    { body: null },
    { blocked: true },
    { id: 'bad' },
    { createdAt: 'bad' },
  ])('rejects mismatched/malformed receipts %j', async (change) => {
    const p = port();
    p.send.mockResolvedValue({ ok: true, data: { ...reply, ...change } });
    expect(await sendReply(p, input)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it.each(Object.keys(REPLY_ERROR_STATUS))(
    'propagates %s without automatic mutation retry',
    async (code) => {
      const p = port();
      p.send.mockResolvedValue({ ok: false, code });
      expect(await sendReply(p, input)).toEqual({ ok: false, code });
      expect(p.send).toHaveBeenCalledTimes(1);
    },
  );
  it('treats thrown unknown outcome as unavailable, never resubmits', async () => {
    const p = port();
    p.send.mockRejectedValue(new Error('private'));
    expect(await sendReply(p, input)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(p.send).toHaveBeenCalledTimes(1);
  });
});
