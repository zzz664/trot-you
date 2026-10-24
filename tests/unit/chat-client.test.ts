// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markChatRead, readChatPage } from '@/client/chat';
import {
  CHAT_CURSOR_MAX_LENGTH,
  CHAT_ERROR_STATUS,
  CHAT_RESPONSE_MAX_BYTES,
  type ChatPageInput,
} from '@/config/chat';
import { chatMessagesPath, chatReadPath } from '@/config/routes';
import {
  chatUiIds as ids,
  chatUiPage,
  chatUiMessage,
} from './chat-ui-fixtures';
const fetcher = vi.fn<typeof fetch>();
const slug = 'fictional-singer';
const readInput = { slug, messageId: ids.first };
const receipt = {
  messageId: ids.first,
  readAt: '2026-10-24T01:04:00+00:00',
  readCount: 1,
};
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());
describe('fan chat same-origin validated transport', () => {
  it('reads only route-bound slug and exact cursor/limit without cache or redirects', async () => {
    fetcher.mockResolvedValue(response({ ok: true, data: chatUiPage() }));
    expect(await readChatPage({ slug, cursor: 'b2xkZXI', limit: 30 })).toEqual({
      ok: true,
      data: chatUiPage(),
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `${chatMessagesPath(slug)}?cursor=b2xkZXI&limit=30`,
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty('body');
  });
  it('first page omits invented client defaults and timestamps', async () => {
    fetcher.mockResolvedValue(response({ ok: true, data: chatUiPage() }));
    await readChatPage({ slug });
    expect(fetcher.mock.calls[0]?.[0]).toBe(chatMessagesPath(slug));
  });
  it('read mark is exact path with empty JSON and no claimed actor/readAt/count', async () => {
    fetcher.mockResolvedValue(response({ ok: true, data: receipt }));
    expect(await markChatRead(readInput)).toEqual({ ok: true, data: receipt });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      chatReadPath(slug, ids.first),
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
    );
  });
  it.each([
    { slug: '' },
    { slug: '../other' },
    { slug: 'UPPER' },
    { slug, cursor: '' },
    { slug, cursor: '=' },
    { slug, cursor: 'a'.repeat(CHAT_CURSOR_MAX_LENGTH + 1) },
    { slug, limit: 0 },
    { slug, limit: 101 },
    { slug, limit: 1.5 },
    { slug, limit: NaN },
    { slug, actorId: ids.first },
  ])('rejects malformed page input %j without a request', async (input) => {
    expect(await readChatPage(input as ChatPageInput)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { slug, messageId: 'wrong' },
    { slug: '../other', messageId: ids.first },
    { ...readInput, actorId: ids.second },
  ])('rejects malformed read identities %j', async (input) => {
    expect(await markChatRead(input)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(Object.entries(CHAT_ERROR_STATUS))(
    'accepts documented %s only with matching HTTP status',
    async (code, status) => {
      fetcher.mockResolvedValueOnce(response({ ok: false, code }, status));
      expect(await readChatPage({ slug })).toEqual({ ok: false, code });
      fetcher.mockResolvedValueOnce(response({ ok: false, code }, 200));
      expect(await readChatPage({ slug })).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
  it.each([
    chatUiPage({
      artist: { slug: 'other-artist', name: '다른 가수', description: null },
    }),
    chatUiPage({ messages: [chatUiMessage(), chatUiMessage()] }),
    chatUiPage({ messages: [], nextCursor: 'Y3Vyc29y' }),
    chatUiPage({ hasAccess: false }),
    chatUiPage({ readCount: -1 }),
    chatUiPage({ readCount: Number.MAX_SAFE_INTEGER + 1 }),
    chatUiPage({ messages: [chatUiMessage({ sentAt: 'bad' })] }),
  ])('fails closed for invalid page structure/identity', async (data) => {
    fetcher.mockResolvedValue(response({ ok: true, data }));
    expect(await readChatPage({ slug })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('accepts clean access loss with no paid message projection', async () => {
    const data = chatUiPage({
      hasAccess: false,
      messages: [],
      nextCursor: null,
      readCount: 0,
    });
    fetcher.mockResolvedValue(response({ ok: true, data }));
    expect(await readChatPage({ slug })).toEqual({ ok: true, data });
  });
  it('rejects repeated next cursor or response exceeding requested limit', async () => {
    fetcher.mockResolvedValueOnce(response({ ok: true, data: chatUiPage() }));
    expect(await readChatPage({ slug, cursor: 'Y3Vyc29y' })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    fetcher.mockResolvedValueOnce(
      response({
        ok: true,
        data: chatUiPage({
          messages: [chatUiMessage(), chatUiMessage({ id: ids.second })],
        }),
      }),
    );
    expect(await readChatPage({ slug, limit: 1 })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('rejects a receipt for another message and strips unexpected payload fields', async () => {
    fetcher.mockResolvedValueOnce(
      response({ ok: true, data: { ...receipt, messageId: ids.second } }),
    );
    expect(await markChatRead(readInput)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    fetcher.mockResolvedValueOnce(
      response({ ok: true, data: { ...receipt, raw: 'not retained' } }),
    );
    expect(await markChatRead(readInput)).toEqual({ ok: true, data: receipt });
  });
  it.each([400, 403, 500])(
    'rejects successful JSON paired with HTTP %s',
    async (status) => {
      fetcher.mockResolvedValue(
        response({ ok: true, data: chatUiPage() }, status),
      );
      expect(await readChatPage({ slug })).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
  it.each([
    {},
    null,
    { ok: false, code: 'SECRET_DATABASE_ERROR' },
    { ok: true, data: {} },
    { ok: true, data: chatUiPage(), extra: 'unexpected' },
  ])('rejects malformed result envelope %j', async (body) => {
    fetcher.mockResolvedValue(response(body));
    expect(await readChatPage({ slug })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('rejects non-JSON, malformed UTF8 and malformed JSON', async () => {
    for (const value of [
      new Response('<html>login</html>'),
      new Response(new Uint8Array([0xc3, 0x28]), {
        headers: { 'content-type': 'application/json' },
      }),
      new Response('{', { headers: { 'content-type': 'application/json' } }),
    ]) {
      fetcher.mockResolvedValueOnce(value);
      expect(await readChatPage({ slug })).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    }
  });
  it('bounds streamed response bytes and cancels oversized body', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(CHAT_RESPONSE_MAX_BYTES + 1));
      },
      cancel,
    });
    fetcher.mockResolvedValue(
      new Response(stream, { headers: { 'content-type': 'application/json' } }),
    );
    expect(await readChatPage({ slug })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('does not start a request after caller has already canceled', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await readChatPage({ slug }, controller.signal)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('combines caller cancellation with deadline and never retries response loss', async () => {
    const controller = new AbortController();
    fetcher.mockImplementation(async (_path, options) => {
      controller.abort();
      expect(options?.signal?.aborted).toBe(true);
      throw new Error('connection lost after commit');
    });
    expect(await markChatRead(readInput, controller.signal)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
