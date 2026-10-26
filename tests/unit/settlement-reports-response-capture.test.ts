// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import type { Page, Route, Request as BrowserRequest } from '@playwright/test';
import {
  captureReportResponse,
  type ReportResponseExpectation,
} from '../e2e/settlement-reports/response-capture';
import { SETTLEMENT_REPORTS } from '@/config/settlement-reports';
const actor = 'd4000000-0000-4000-8000-000000000001';
const expected: ReportResponseExpectation = {
  url: 'http://127.0.0.1:3100/api/admin/settlements?artist_id=exact&month=2026-01-01',
  method: 'GET',
  actorId: actor,
  status: 200,
};
async function setup(
  overrides: {
    url?: string;
    method?: string;
    actor?: string;
    status?: number;
    headers?: Record<string, string>;
    bytes?: Buffer;
    post?: unknown;
    expected?: ReportResponseExpectation;
  } = {},
) {
  const order: string[] = [];
  const bytes =
    overrides.bytes ?? Buffer.from('{"ok":true,"data":{"actual":"upstream"}}');
  const headers = overrides.headers ?? {
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-type': 'application/json',
  };
  const request = {
    url: () => overrides.url ?? expected.url,
    method: () => overrides.method ?? 'GET',
    headers: () => ({
      [SETTLEMENT_REPORTS.actorHeader.toLowerCase()]: overrides.actor ?? actor,
    }),
    postDataJSON: () => overrides.post,
  };
  const upstream = {
    status: () => overrides.status ?? 200,
    headers: () => headers,
    body: vi.fn(async () => {
      order.push('read-real-body');
      return bytes;
    }),
  };
  const route = {
    request: () => request,
    fetch: vi.fn(async () => {
      order.push('fetch-once');
      return upstream;
    }),
    fulfill: vi.fn(async () => {
      order.push('forward');
    }),
    abort: vi.fn(async () => {
      order.push('abort');
    }),
  };
  let handler!: Parameters<Page['route']>[1];
  let matcher!: Parameters<Page['route']>[0];
  const register = vi.fn(async (...args: Parameters<Page['route']>) => {
    const [url, callback] = args;
    matcher = url;
    handler = callback;
    return {
      dispose: async () => undefined,
      [Symbol.asyncDispose]: async () => undefined,
    };
  });
  const page: Pick<Page, 'route'> = { route: register };
  const capture = await captureReportResponse(
    page,
    overrides.expected ?? expected,
  );
  const handle = () =>
    handler(route as unknown as Route, request as unknown as BrowserRequest);
  return {
    capture,
    handle,
    route,
    upstream,
    register,
    matcher,
    order,
    bytes,
    headers,
  };
}
it('captures real upstream bytes before forwarding once; no browser CDP body/replay/redirect/retry', async () => {
  const f = await setup();
  await f.handle();
  const response = await f.capture.result();
  expect(f.order).toEqual(['fetch-once', 'read-real-body', 'forward']);
  expect(f.route.fetch).toHaveBeenCalledExactlyOnceWith({
    maxRedirects: 0,
    maxRetries: 0,
  });
  expect(f.upstream.body).toHaveBeenCalledOnce();
  expect(f.route.fulfill).toHaveBeenCalledExactlyOnceWith({
    response: f.upstream,
    body: f.bytes,
  });
  expect(f.route.abort).not.toHaveBeenCalled();
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    ok: true,
    data: { actual: 'upstream' },
  });
  expect(f.register.mock.calls[0]).toHaveLength(3);
  expect(f.register.mock.calls[0]?.[2]).toEqual({ times: 1 });
});
it('route selection is exact URL including query and origin, never broad path match', async () => {
  const f = await setup();
  expect(typeof f.matcher).toBe('function');
  if (typeof f.matcher !== 'function') throw new Error('exact matcher missing');
  expect(f.matcher(new URL(expected.url))).toBe(true);
  for (const value of [
    expected.url + '&extra=1',
    expected.url.replace('month=2026-01', 'month=2026-02'),
    expected.url.replace(':3100', ':3101'),
  ])
    expect(f.matcher(new URL(value))).toBe(false);
});
it('saved body and headers remain independent after upstream disposal or caller mutation', async () => {
  const f = await setup();
  await f.handle();
  const response = await f.capture.result();
  f.bytes.fill(0);
  f.headers['cache-control'] = 'public';
  f.upstream.body.mockRejectedValue(new Error('upstream disposed'));
  (await response.body()).fill(0);
  response.headers()['x-content-type-options'] = 'changed';
  expect(await response.json()).toEqual({
    ok: true,
    data: { actual: 'upstream' },
  });
  expect(response.headers()['cache-control']).toBe('private, no-store');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
});
it('forwards actual denied JSON unchanged for existing failure assertions', async () => {
  const f = await setup({
    status: 403,
    bytes: Buffer.from('{"ok":false,"code":"FORBIDDEN"}'),
    expected: { ...expected, status: 403 },
  });
  await f.handle();
  expect(await (await f.capture.result()).json()).toEqual({
    ok: false,
    code: 'FORBIDDEN',
  });
  expect(f.route.fetch).toHaveBeenCalledOnce();
});
it('compares exact mutation body before I/O', async () => {
  const body = { reportId: 'fixed', expectedRevision: 'reviewed' };
  const f = await setup({
    method: 'POST',
    post: body,
    expected: { ...expected, method: 'POST', body },
  });
  await f.handle();
  expect((await f.capture.result()).status()).toBe(200);
  const bad = await setup({
    method: 'POST',
    post: { ...body, payout: true },
    expected: { ...expected, method: 'POST', body },
  });
  await bad.handle();
  await expect(bad.capture.result()).rejects.toThrow();
  expect(bad.route.fetch).not.toHaveBeenCalled();
  expect(bad.route.abort).toHaveBeenCalledOnce();
});
it.each([
  { url: expected.url + '&wrong=1' },
  { method: 'POST' },
  { actor: 'other-current-actor' },
])('binding mismatch aborts before upstream I/O %#', async (options) => {
  const f = await setup(options);
  await f.handle();
  await expect(f.capture.result()).rejects.toThrow();
  expect(f.route.fetch).not.toHaveBeenCalled();
  expect(f.route.fulfill).not.toHaveBeenCalled();
  expect(f.route.abort).toHaveBeenCalledOnce();
});
it.each([
  { status: 500 },
  {
    headers: { 'cache-control': 'public', 'x-content-type-options': 'nosniff' },
  },
  { headers: { 'cache-control': 'private, no-store' } },
  { bytes: Buffer.alloc(0) },
])(
  'actual status/private/header/body mismatch remains failure %#',
  async (options) => {
    const f = await setup(options);
    await f.handle();
    await expect(f.capture.result()).rejects.toThrow();
    expect(f.route.fetch).toHaveBeenCalledOnce();
    expect(f.route.fulfill).not.toHaveBeenCalled();
    expect(f.route.abort).toHaveBeenCalledOnce();
  },
);
it('real upstream body-read failure is preserved and never replaced by JSON success', async () => {
  const f = await setup();
  const failure = new Error('actual upstream read failure');
  f.upstream.body.mockRejectedValue(failure);
  await f.handle();
  await expect(f.capture.result()).rejects.toBe(failure);
  expect(f.route.fulfill).not.toHaveBeenCalled();
  expect(f.route.abort).toHaveBeenCalledOnce();
});
it('retains both evidence and cleanup failure instead of swallowing either', async () => {
  const f = await setup({ actor: 'wrong' });
  f.route.abort.mockRejectedValue(new Error('abort failure'));
  await f.handle();
  await expect(f.capture.result()).rejects.toBeInstanceOf(AggregateError);
  expect(f.route.fulfill).not.toHaveBeenCalled();
});
it('fulfill failure cannot trigger a second terminal action or replay', async () => {
  const f = await setup();
  const failure = new Error('forward failure');
  f.route.fulfill.mockRejectedValue(failure);
  await f.handle();
  await expect(f.capture.result()).rejects.toBe(failure);
  expect(f.route.fetch).toHaveBeenCalledOnce();
  expect(f.route.abort).not.toHaveBeenCalled();
});
it('does not turn invalid real JSON into a successful assertion', async () => {
  const f = await setup({ bytes: Buffer.from('invalid real JSON') });
  await f.handle();
  await expect((await f.capture.result()).json()).rejects.toThrow();
});
it('report suite reads browser body only through upstream captures; navigation response is status-only', () => {
  const source = readFileSync(
    'tests/e2e/settlement-reports/settlement-reports.spec.ts',
    'utf8',
  );
  expect(source.match(/page\.waitForResponse\(/g)).toHaveLength(1);
  expect(source).toContain('expect((await navigation).status()).toBe(200)');
  expect(source).toContain(
    'checkWorkbook(await downloaded.body(), world, confirmed.report!)',
  );
  expect(source).toContain('const downloaded = await response.result()');
  expect(source).toContain('const data = await success(await result.result())');
  expect(source).not.toMatch(
    /success\(await (?:response|refresh|backRead)\)|failure\(await response,/,
  );
  for (const assertion of [
    'expect(financialFingerprint(world)).toBe(moneyBefore)',
    'expect(calls).toBe(1)',
    'copy.errors.REVISION_CONFLICT',
    'copy.errors.FORBIDDEN',
    'copy.errors.POLICY_REQUIRED',
    'toBeInViewport()',
  ])
    expect(source).toContain(assertion);
});
