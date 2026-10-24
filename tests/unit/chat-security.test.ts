// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAT_BODY_LIMIT, CHAT_BODY_TIMEOUT_MS } from '@/config/chat';
import { chatReadBody } from '@/server/chat/security';
const url = 'https://app.example';
function request(body: BodyInit | null, type = 'application/json') {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': type },
    body,
    duplex: 'half',
  } as RequestInit);
}
afterEach(() => vi.useRealTimers());
describe('finite empty-object read receipt body contract', () => {
  it.each(['{}', ' \n{} \t', '{}'.padStart(CHAT_BODY_LIMIT, ' ')])(
    'accepts only an empty object within byte limit',
    async (body) => {
      expect(await chatReadBody(request(body))).toBe(true);
    },
  );
  it.each([
    null,
    '',
    'null',
    '[]',
    'true',
    '1',
    '""',
    '{',
    '{"actorId":"x"}',
    '{"readCount":0}',
    '{"__proto__":{}}',
    '{}'.padStart(CHAT_BODY_LIMIT + 1, ' '),
  ])(
    'rejects absent, malformed, oversized, or nonempty input %s',
    async (body) => {
      expect(await chatReadBody(request(body))).toBe(false);
    },
  );
  it('requires the JSON media type but allows charset parameter', async () => {
    expect(await chatReadBody(request('{}', 'text/plain'))).toBe(false);
    expect(
      await chatReadBody(request('{}', 'application/json; charset=utf-8')),
    ).toBe(true);
  });
  it('rejects invalid UTF-8 instead of replacing bytes', async () => {
    expect(await chatReadBody(request(new Uint8Array([123, 255, 125])))).toBe(
      false,
    );
  });
  it('handles split chunk boundaries without assuming a buffered request', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([123]));
        controller.enqueue(new Uint8Array([125]));
        controller.close();
      },
    });
    expect(await chatReadBody(request(stream))).toBe(true);
  });
  it('cancels stalled readers at the configured bound and does not write evidence', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const pending = chatReadBody(request(stream));
    await vi.advanceTimersByTimeAsync(CHAT_BODY_TIMEOUT_MS);
    expect(await pending).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels an over-limit stream and releases its reader lock', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(CHAT_BODY_LIMIT + 1));
      },
      cancel,
    });
    expect(await chatReadBody(request(stream))).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });
});
