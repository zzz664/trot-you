// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPLY_BODY_LIMIT, REPLY_BODY_TIMEOUT_MS } from '@/config/replies';
import { replyWriteBody } from '@/server/replies/security';
const body = {
  operationId: 'a2000000-0000-4000-8000-000000000002',
  messageId: null,
  body: '고맙습니다 💜',
};
function request(
  value: string | ReadableStream<Uint8Array>,
  type = 'application/json',
) {
  return new Request('https://app.example', {
    method: 'POST',
    headers: { 'Content-Type': type },
    body: value,
    duplex: 'half',
  } as RequestInit);
}
afterEach(() => vi.useRealTimers());
describe('bounded reply body decoding', () => {
  it('accepts UTF8 split across byte chunks and preserves raw body', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    expect(await replyWriteBody(request(stream))).toEqual(body);
  });
  it('rejects empty/absent content without pretending submitted', async () => {
    expect(
      await replyWriteBody(
        new Request('https://app.example', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ).toBeNull();
  });
  it('rejects non-UTF8 bytes', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(255));
        controller.close();
      },
    });
    expect(await replyWriteBody(request(stream))).toBeNull();
  });
  it('cancels over-limit chunks', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(REPLY_BODY_LIMIT + 1));
      },
      cancel,
    });
    expect(await replyWriteBody(request(stream))).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('times out an unfinished stream and releases the reader', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const promise = replyWriteBody(request(stream));
    await vi.advanceTimersByTimeAsync(REPLY_BODY_TIMEOUT_MS);
    expect(await promise).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });
  it('fails a throwing stream closed', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('private');
      },
    });
    expect(await replyWriteBody(request(stream))).toBeNull();
    expect(stream.locked).toBe(false);
  });
});
