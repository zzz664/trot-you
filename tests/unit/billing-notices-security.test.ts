// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { billingNoticeBody } from '@/server/billing-notices/security';
import { BILLING_NOTICE } from '@/config/billing-notices';
afterEach(() => vi.useRealTimers());
it('reads bounded JSON only without trusting amount or actor authority', async () => {
  const data = { noticeId: '00000000-0000-4000-8000-000000000001' };
  expect(
    await billingNoticeBody(
      new Request('https://app.example', {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(data),
      }),
    ),
  ).toEqual(data);
});
it.each([
  ['text/plain', '{}'],
  ['application/json', '{'],
  ['application/json', 'x'.repeat(BILLING_NOTICE.bodyLimit + 1)],
])('fails unsupported/malformed/oversized body %#', async (type, body) => {
  expect(
    await billingNoticeBody(
      new Request('https://app.example', {
        method: 'POST',
        headers: { 'content-type': type },
        body,
      }),
    ),
  ).toBeNull();
});
it('rejects malformed UTF-8 instead of replacing financial request bytes', async () => {
  expect(
    await billingNoticeBody(
      new Request('https://app.example', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: new Uint8Array([0xc3, 0x28]),
      }),
    ),
  ).toBeNull();
});
it('bounds a never-ending request body and cancels it', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const body = new ReadableStream({ cancel });
  const request = new Request('https://app.example', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    duplex: 'half',
  } as RequestInit);
  const pending = billingNoticeBody(request);
  await vi.advanceTimersByTimeAsync(BILLING_NOTICE.bodyTimeoutMs);
  expect(await pending).toBeNull();
  expect(cancel).toHaveBeenCalledOnce();
});
