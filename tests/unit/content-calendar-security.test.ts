// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTENT_CALENDAR } from '@/config/content-calendar';
import { contentCalendarBody } from '@/server/content-calendar/security';
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
describe('bounded content calendar body decoding', () => {
  it('accepts UTF8 split across byte chunks and preserves input', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    expect(await contentCalendarBody(request(stream))).toEqual(body);
  });
  it('rejects empty/absent content without attempting a read', async () => {
    expect(
      await contentCalendarBody(
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
    expect(await contentCalendarBody(request(stream))).toBeNull();
  });
  it('cancels over-limit chunks', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(CONTENT_CALENDAR.bodyLimit + 1));
      },
      cancel,
    });
    expect(await contentCalendarBody(request(stream))).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('times out an unfinished stream and releases the reader', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const promise = contentCalendarBody(request(stream));
    await vi.advanceTimersByTimeAsync(CONTENT_CALENDAR.bodyTimeoutMs);
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
    expect(await contentCalendarBody(request(stream))).toBeNull();
    expect(stream.locked).toBe(false);
  });
});
it.each([
  'text/plain',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  '',
])('rejects unsupported content type %s', async (type) =>
  expect(await contentCalendarBody(request('{}', type))).toBeNull(),
);
it.each(['', '{', 'undefined', 'NaN'])(
  'rejects invalid JSON %j',
  async (value) => expect(await contentCalendarBody(request(value))).toBeNull(),
);
it('counts actual UTF8 bytes rather than characters or claimed content-length', async () => {
  const value = JSON.stringify({
    text: '가'.repeat(CONTENT_CALENDAR.bodyLimit / 2),
  });
  const req = new Request('https://app.example', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': '1' },
    body: value,
  });
  expect(await contentCalendarBody(req)).toBeNull();
});
it('accepts JSON exactly at byte bound and rejects one byte over', async () => {
  const value = '"' + 'a'.repeat(CONTENT_CALENDAR.bodyLimit - 2) + '"';
  expect(await contentCalendarBody(request(value))).toBe(
    'a'.repeat(CONTENT_CALENDAR.bodyLimit - 2),
  );
  expect(await contentCalendarBody(request(value + ' '))).toBeNull();
});
it('rejects a truncated multibyte code point at end of stream', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.of(0xe3, 0x81));
      controller.close();
    },
  });
  expect(await contentCalendarBody(request(stream))).toBeNull();
});
