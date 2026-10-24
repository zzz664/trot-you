// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readReplyPage, sendReply } from '@/client/replies';
import {
  REPLY_ERROR_STATUS,
  REPLY_MAX_BODY_LENGTH,
  REPLY_RESPONSE_MAX_BYTES,
  type ReplyPageInput,
  type ReplyWriteInput,
} from '@/config/replies';
import { fanRepliesPath } from '@/config/routes';
import {
  ownReply,
  replyUiPage,
  replyUiReceipt,
  replyUiIds as ids,
  replyUiSlug as slug,
} from './reply-ui-fixtures';
const fetcher = vi.fn();
const input: ReplyWriteInput = {
  slug,
  operationId: ids.operation,
  body: '항상 응원해요.',
  messageId: null,
};
function response(
  value: unknown,
  status = 200,
  headers: Record<string, string> = { 'Content-Type': 'application/json' },
) {
  return new Response(JSON.stringify(value), { status, headers });
}
beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());
describe('reply transport read contract', () => {
  it('requests bounded own page without credentials in payload', async () => {
    fetcher.mockResolvedValue(response({ ok: true, data: replyUiPage() }));
    expect(await readReplyPage({ slug, cursor: 'YWJj', limit: 10 })).toEqual({
      ok: true,
      data: replyUiPage(),
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `${fanRepliesPath(slug)}?cursor=YWJj&limit=10`,
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(fetcher.mock.calls[0]![1]).not.toHaveProperty('body');
  });
  it.each([
    { slug: '../bad' },
    { slug, limit: 0 },
    { slug, limit: 101 },
    { slug, cursor: '!' },
    { slug, actorId: ids.first },
  ])('rejects invalid input %j without I/O', async (value) => {
    expect(await readReplyPage(value as ReplyPageInput)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    replyUiPage({ slug: 'other-singer' }),
    replyUiPage({ replies: [ownReply(), ownReply()] }),
    replyUiPage({ nextCursor: 'YWJj' }),
    replyUiPage({ maxLength: 0 }),
    replyUiPage({ sendReady: undefined as unknown as boolean }),
    replyUiPage({ replies: [ownReply({ blocked: true })] }),
    replyUiPage({ replies: [ownReply({ body: null })] }),
    replyUiPage({ replies: [ownReply({ createdAt: 'tomorrow' })] }),
  ])('rejects malformed or mismatched page %j', async (page) => {
    fetcher.mockResolvedValue(response({ ok: true, data: page }));
    expect(await readReplyPage({ slug })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('does not accept repeated pagination cursors or over-limit pages', async () => {
    fetcher.mockResolvedValue(
      response({
        ok: true,
        data: replyUiPage({ replies: [ownReply()], nextCursor: 'YWJj' }),
      }),
    );
    expect(await readReplyPage({ slug, cursor: 'YWJj' })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    fetcher.mockResolvedValue(
      response({
        ok: true,
        data: replyUiPage({
          replies: [ownReply(), ownReply({ id: ids.second })],
        }),
      }),
    );
    expect(await readReplyPage({ slug, limit: 1 })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('preserves microsecond timestamps, literal text, unavailable send policy and blocked markers', async () => {
    const page = replyUiPage({
      sendReady: false,
      replies: [
        ownReply({ body: '<b>{이름}</b>' }),
        ownReply({
          id: ids.second,
          body: null,
          blocked: true,
          operationId: null,
        }),
      ],
    });
    fetcher.mockResolvedValue(response({ ok: true, data: page }));
    expect(await readReplyPage({ slug })).toEqual({ ok: true, data: page });
  });
});
describe('reply transport immutable submission', () => {
  it('posts only immutable operation/body/target and verifies receipt', async () => {
    fetcher.mockResolvedValue(response({ ok: true, data: replyUiReceipt() }));
    expect(await sendReply(input)).toEqual({
      ok: true,
      data: replyUiReceipt(),
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      fanRepliesPath(slug),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          operationId: ids.operation,
          body: input.body,
          messageId: null,
        }),
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
      }),
    );
  });
  it.each([
    { ...input, operationId: 'bad' },
    { ...input, messageId: 'bad' },
    { ...input, body: '' },
    { ...input, body: '가'.repeat(REPLY_MAX_BODY_LENGTH + 1) },
    { ...input, actorId: ids.first },
    { ...input, slug: '../other' },
    { ...input, messageId: undefined },
  ])('rejects malformed submission without sending %j', async (value) => {
    expect(await sendReply(value as ReplyWriteInput)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses Unicode scalar count rather than UTF-16 length for transport limit', async () => {
    const body = '😀'.repeat(REPLY_MAX_BODY_LENGTH);
    fetcher.mockResolvedValue(
      response({ ok: true, data: replyUiReceipt({ body }) }),
    );
    expect((await sendReply({ ...input, body })).ok).toBe(true);
  });
  it.each([
    { slug: 'other-singer', reply: ownReply() },
    replyUiReceipt({ operationId: ids.operation2 }),
    replyUiReceipt({ operationId: null }),
    replyUiReceipt({ messageId: ids.message }),
    replyUiReceipt({ body: 'changed content' }),
    replyUiReceipt({ blocked: true, body: 'must be redacted' }),
  ])(
    'refuses receipt belonging to another immutable resource %j',
    async (receipt) => {
      fetcher.mockResolvedValue(response({ ok: true, data: receipt }));
      expect(await sendReply(input)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
  it('accepts a redacted replay receipt without fabricating its original text', async () => {
    const data = replyUiReceipt({ blocked: true, body: null });
    fetcher.mockResolvedValue(response({ ok: true, data }));
    expect(await sendReply(input)).toEqual({ ok: true, data });
  });
  it('does not automatically retry network/lost response', async () => {
    fetcher.mockRejectedValue(new Error('lost'));
    expect(await sendReply(input)).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
describe('reply transport status and bounded response handling', () => {
  it.each(Object.entries(REPLY_ERROR_STATUS))(
    'recognizes %s only with matching HTTP status',
    async (code, status) => {
      fetcher.mockResolvedValue(response({ ok: false, code }, status));
      expect(await sendReply(input)).toEqual({ ok: false, code });
      fetcher.mockResolvedValue(response({ ok: false, code }, 200));
      expect(await sendReply(input)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
  it.each([
    response({ ok: true, data: replyUiReceipt() }, 201),
    response({ ok: true, data: replyUiReceipt() }, 500),
    response({ ok: false, code: 'UNKNOWN' }, 400),
    response({ ok: true, data: replyUiReceipt(), actorId: ids.first }),
    response({ ok: true, data: replyUiReceipt() }, 200, {
      'Content-Type': 'text/html',
    }),
    new Response('not json', {
      headers: { 'Content-Type': 'application/json' },
    }),
    new Response(null, { headers: { 'Content-Type': 'application/json' } }),
    new Response(new Uint8Array([0xff]), {
      headers: { 'Content-Type': 'application/json' },
    }),
  ])('fails closed for malformed response', async (value) => {
    fetcher.mockResolvedValue(value);
    expect(await sendReply(input)).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('cancels oversized bodies', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(REPLY_RESPONSE_MAX_BYTES + 1));
      },
      cancel,
    });
    fetcher.mockResolvedValue(
      new Response(stream, { headers: { 'Content-Type': 'application/json' } }),
    );
    expect(await sendReply(input)).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('does not send already canceled operations and propagates external abort', async () => {
    const canceled = AbortSignal.abort();
    expect(await sendReply(input, canceled)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(response({ ok: true, data: replyUiReceipt() }));
    const controller = new AbortController();
    await sendReply(input, controller.signal);
    const signal = fetcher.mock.calls[0]![1].signal as AbortSignal;
    controller.abort();
    expect(signal.aborted).toBe(true);
  });
});
