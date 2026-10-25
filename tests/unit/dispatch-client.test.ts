import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelDispatch,
  readDispatchPage,
  submitDispatch,
} from '@/client/dispatch';
import {
  DISPATCH_ERROR_STATUS,
  DISPATCH_RESPONSE_MAX_BYTES,
  type DispatchSubmitInput,
} from '@/config/message-dispatch';
import { artistDispatchApiPath } from '@/config/routes';
import {
  dispatchUiIds as ids,
  dispatchUiMessage,
  dispatchUiPage,
} from './dispatch-ui-fixtures';
const fetchMock = vi.fn();
const slug = dispatchUiPage().artist.slug;
const input: DispatchSubmitInput = {
  slug,
  messageId: ids.message,
  operationId: ids.operation,
  expectedRevision: 1,
  scheduledAt: null,
  confirmed: true,
};
const cancelInput = {
  slug,
  messageId: ids.message,
  operationId: ids.operation,
  confirmed: true as const,
};
const success = () => ({ ok: true, data: dispatchUiMessage() });
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
  respond(success());
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe('dispatch browser transport', () => {
  it('posts same-origin immutable confirmed request without slug in JSON', async () => {
    expect(await submitDispatch(input)).toEqual(success());
    const [path, options] = fetchMock.mock.calls[0]!;
    expect(path).toBe(artistDispatchApiPath(slug, 'submit'));
    expect(options).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(JSON.parse(options.body)).toEqual({
      messageId: ids.message,
      operationId: ids.operation,
      expectedRevision: 1,
      scheduledAt: null,
      confirmed: true,
    });
  });
  it('accepts current canceled state returned by exact submit replay', async () => {
    const item = dispatchUiMessage({
      status: 'canceled',
      canceledAt: '2026-10-24T12:01:00Z',
      canCancel: false,
      notificationState: 'canceled',
    });
    respond({ ok: true, data: item });
    expect(await submitDispatch(input)).toEqual({ ok: true, data: item });
  });
  it('binds submit receipt resource and scheduled instant', async () => {
    respond({ ok: true, data: dispatchUiMessage({ id: ids.other }) });
    expect(await submitDispatch(input)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    respond(success());
    expect(
      await submitDispatch({ ...input, scheduledAt: '2026-10-25T12:00:00Z' }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
    respond(success());
    expect(
      (
        await submitDispatch({
          ...input,
          scheduledAt: '2026-10-24T21:00:00+09:00',
        })
      ).ok,
    ).toBe(true);
  });
  it('never claims cancellation from an uncanceled or other-resource receipt', async () => {
    expect(await cancelDispatch(cancelInput)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    respond({
      ok: true,
      data: dispatchUiMessage({
        status: 'canceled',
        canceledAt: '2026-10-24T12:01:00Z',
        canCancel: false,
        notificationState: 'canceled',
      }),
    });
    expect((await cancelDispatch(cancelInput)).ok).toBe(true);
    expect(fetchMock.mock.calls.at(-1)![0]).toBe(
      artistDispatchApiPath(slug, 'cancel'),
    );
  });
  it.each(Object.entries(DISPATCH_ERROR_STATUS))(
    'accepts %s only at matching HTTP status',
    async (code, status) => {
      respond({ ok: false, code }, status);
      expect(await submitDispatch(input)).toEqual({ ok: false, code });
      respond({ ok: false, code }, 200);
      expect(await submitDispatch(input)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
  it.each([
    { slug: '../../other' },
    { messageId: 'bad' },
    { operationId: 'bad' },
    { expectedRevision: 0 },
    { scheduledAt: '2026-10-25T00:30' },
    { confirmed: false },
    { actorId: ids.other },
  ])('rejects invalid or forged submit %j', async (override) => {
    expect(
      await submitDispatch({ ...input, ...override } as DispatchSubmitInput),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects malformed cancellation and context before fetching', async () => {
    expect(
      await cancelDispatch({ ...cancelInput, confirmed: false } as never),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(await readDispatchPage({ slug, messageId: 'bad' })).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('binds page artist, exact selection, unique IDs and progress cursor', async () => {
    respond({ ok: true, data: dispatchUiPage() });
    expect((await readDispatchPage({ slug, messageId: null })).ok).toBe(true);
    respond({ ok: true, data: dispatchUiPage() });
    expect(await readDispatchPage({ slug, messageId: ids.message })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    respond({
      ok: true,
      data: dispatchUiPage({ selectedMessage: dispatchUiMessage() }),
    });
    expect((await readDispatchPage({ slug, messageId: ids.message })).ok).toBe(
      true,
    );
    expect(await readDispatchPage({ slug, messageId: ids.other })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(await readDispatchPage({ slug, messageId: null })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    for (const override of [
      { artist: { ...dispatchUiPage().artist, slug: 'another-artist' } },
      { messages: [dispatchUiMessage(), dispatchUiMessage()] },
      { hasMore: true, nextCursor: null },
      { hasMore: false, nextCursor: 'cursor' },
    ]) {
      respond({ ok: true, data: dispatchUiPage(override) });
      expect(await readDispatchPage({ slug, messageId: null })).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    }
    respond({
      ok: true,
      data: dispatchUiPage({ hasMore: true, nextCursor: 'cursor' }),
    });
    expect(
      await readDispatchPage({ slug, messageId: null, cursor: 'cursor' }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('does not retry writes or read already-aborted requests', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'));
    expect(await submitDispatch(input)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    fetchMock.mockClear();
    const controller = new AbortController();
    controller.abort();
    expect(await submitDispatch(input, controller.signal)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['text/html', 'text/plain'])(
    'rejects %s transport before private data parsing',
    async (mime) => {
      respond(success(), 200, mime);
      expect(await submitDispatch(input)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
  it('rejects invalid envelope, unknown error, HTTP mismatch, broken UTF-8 and missing body', async () => {
    for (const response of [
      new Response(JSON.stringify({ ...success(), debug: 'private' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
      new Response(JSON.stringify(success()), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Response(JSON.stringify({ ok: false, code: 'UNKNOWN' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Response('{', { headers: { 'Content-Type': 'application/json' } }),
      new Response(new Uint8Array([0xff]), {
        headers: { 'Content-Type': 'application/json' },
      }),
      new Response(null, { headers: { 'Content-Type': 'application/json' } }),
    ]) {
      fetchMock.mockResolvedValue(response);
      expect(await submitDispatch(input)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    }
  });
  it('cancels oversized response stream', async () => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(DISPATCH_RESPONSE_MAX_BYTES + 1));
          },
          cancel,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    );
    expect(await submitDispatch(input)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
