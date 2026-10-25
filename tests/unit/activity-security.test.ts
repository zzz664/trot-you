// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVITY_BODY_LIMIT,
  ACTIVITY_BODY_TIMEOUT_MS,
} from '@/config/artist-reply-activity';
import { artistReplyActivityBody } from '@/server/artist-reply-activity/security';
const body = {
  cursor: 'a2000000-0000-4000-8000-000000000002',
  messageId: null,
  label: '고맙습니다 💜',
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
describe('bounded artist activity body decoding', () => {
  it('accepts UTF8 split across byte chunks and preserves input', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    expect(await artistReplyActivityBody(request(stream))).toEqual(body);
  });
  it('rejects empty/absent content without attempting a read', async () => {
    expect(
      await artistReplyActivityBody(
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
    expect(await artistReplyActivityBody(request(stream))).toBeNull();
  });
  it('cancels over-limit chunks', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(ACTIVITY_BODY_LIMIT + 1));
      },
      cancel,
    });
    expect(await artistReplyActivityBody(request(stream))).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('times out an unfinished stream and releases the reader', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const promise = artistReplyActivityBody(request(stream));
    await vi.advanceTimersByTimeAsync(ACTIVITY_BODY_TIMEOUT_MS);
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
    expect(await artistReplyActivityBody(request(stream))).toBeNull();
    expect(stream.locked).toBe(false);
  });
});
