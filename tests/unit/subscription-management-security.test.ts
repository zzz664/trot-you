// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MANAGEMENT_BODY_LIMIT,
  MANAGEMENT_BODY_TIMEOUT_MS,
} from '@/config/subscription-management';
import { managementJson } from '@/server/subscription-management/security';
function request(
  body?: BodyInit,
  type = 'application/json',
  headers: Record<string, string> = {},
) {
  return new Request('https://app.example.test/api/subscriptions/cancel', {
    method: 'POST',
    headers: { 'Content-Type': type, ...headers },
    ...(body === undefined ? {} : { body }),
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  });
}
afterEach(() => vi.useRealTimers());
describe('management request body boundary', () => {
  it('parses JSON only, including charset and split UTF-8 sequences', async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ reason: '허구 테스트' }),
    );
    const stream = new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    expect(
      await managementJson(request(stream, 'application/json; charset=utf-8')),
    ).toEqual({ reason: '허구 테스트' });
  });
  it.each([
    'text/plain',
    'application/x-www-form-urlencoded',
    'multipart/form-data',
    'application/json-patch+json',
    '',
  ])('rejects %s even with JSON-looking content', async (type) => {
    await expect(managementJson(request('{}', type))).rejects.toThrow(
      'INVALID_INPUT',
    );
  });
  it.each(['{bad', '', '{"unfinished":', 'null trailing'])(
    'rejects malformed JSON %#',
    async (body) => {
      await expect(managementJson(request(body))).rejects.toThrow();
    },
  );
  it('does not treat Content-Length as permission for an oversized streamed body', async () => {
    await expect(
      managementJson(
        request('x'.repeat(MANAGEMENT_BODY_LIMIT + 1), 'application/json', {
          'Content-Length': '2',
        }),
      ),
    ).rejects.toThrow('INVALID_INPUT');
  });
  it('counts UTF-8 bytes, not JavaScript string length', async () => {
    const body = JSON.stringify(
      '한'.repeat(Math.floor(MANAGEMENT_BODY_LIMIT / 2)),
    );
    expect(body.length).toBeLessThan(MANAGEMENT_BODY_LIMIT);
    await expect(managementJson(request(body))).rejects.toThrow(
      'INVALID_INPUT',
    );
  });
  it('accepts exactly the technical byte limit without treating it as a commercial limit', async () => {
    const text = 'x'.repeat(MANAGEMENT_BODY_LIMIT - 2);
    expect(await managementJson(request(JSON.stringify(text)))).toBe(text);
  });
  it('rejects absent body and malformed/truncated UTF-8', async () => {
    await expect(managementJson(request())).rejects.toThrow('INVALID_INPUT');
    for (const bytes of [
      Uint8Array.of(0xff),
      Uint8Array.of(0x22, 0xe3, 0x22),
    ]) {
      await expect(managementJson(request(bytes))).rejects.toThrow();
    }
  });
  it('bounds a slow stream and cancels it without waiting indefinitely', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{'));
      },
      cancel,
    });
    const operation = managementJson(request(body));
    const rejection = expect(operation).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(MANAGEMENT_BODY_TIMEOUT_MS);
    await rejection;
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels oversized streams and clears the timer on success and failure', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MANAGEMENT_BODY_LIMIT + 1));
      },
      cancel,
    });
    await expect(managementJson(request(stream))).rejects.toThrow(
      'INVALID_INPUT',
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await expect(managementJson(request('{}'))).resolves.toEqual({});
    expect(vi.getTimerCount()).toBe(0);
  });
});
