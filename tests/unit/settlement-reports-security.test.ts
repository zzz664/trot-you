// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { settlementReportBody } from '@/server/settlement-reports/security';
import { SETTLEMENT_REPORTS } from '@/config/settlement-reports';
function request(body: BodyInit | null, contentType = 'application/json') {
  return new Request('https://app.example', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  });
}
it('parses only bounded JSON and rejects foreign media types/empty/invalid input', async () => {
  expect(await settlementReportBody(request('{"artistId":"fixed"}'))).toEqual({
    artistId: 'fixed',
  });
  for (const candidate of [
    request('{}', 'text/plain'),
    request(null),
    request('{'),
    request('x'.repeat(SETTLEMENT_REPORTS.bodyLimit + 1)),
  ])
    expect(await settlementReportBody(candidate)).toBeNull();
});
it('rejects invalid UTF8 and multibyte byte-limit overflow', async () => {
  expect(
    await settlementReportBody(request(new Uint8Array([0xff]))),
  ).toBeNull();
  expect(
    await settlementReportBody(
      request(JSON.stringify('가'.repeat(SETTLEMENT_REPORTS.bodyLimit))),
    ),
  ).toBeNull();
});
it('cancels a stalled body at its technical timeout without exposing error details', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const stream = new ReadableStream({ cancel });
  const req = new Request('https://app.example', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: stream,
    duplex: 'half',
  } as RequestInit);
  const result = settlementReportBody(req);
  await vi.advanceTimersByTimeAsync(SETTLEMENT_REPORTS.bodyTimeoutMs);
  expect(await result).toBeNull();
  expect(cancel).toHaveBeenCalledOnce();
  vi.useRealTimers();
});

it('cancels unread remainder after an invalid UTF8 chunk', async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0xff]));
    },
    cancel,
  });
  const req = new Request('https://app.example', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: stream,
    duplex: 'half',
  } as RequestInit);
  expect(await settlementReportBody(req)).toBeNull();
  expect(cancel).toHaveBeenCalledOnce();
});
