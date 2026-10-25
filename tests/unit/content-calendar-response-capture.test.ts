// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { Page, Route, APIResponse } from '@playwright/test';
import { observeCalendarRefresh } from '../e2e/content-calendar/response-capture';
const path = '/admin/content-calendar?artist_id=fictional&month=2036-02';
const origin = 'http://127.0.0.1:3100';
function fixture() {
  let handler!: (route: Route) => Promise<void>;
  const register = vi.fn(async (_url, callback) => {
    handler = callback;
  });
  const unroute = vi.fn(async () => undefined);
  const response = { fixture: true } as unknown as APIResponse;
  const fetch = vi.fn(async () => response);
  const fulfill = vi.fn(async () => undefined);
  const abort = vi.fn(async () => undefined);
  const fallback = vi.fn(async () => undefined);
  return {
    page: {
      route: register,
      unroute,
      url: () => origin + path,
    } as unknown as Pick<Page, 'route' | 'unroute' | 'url'>,
    response,
    fetch,
    fulfill,
    abort,
    fallback,
    unroute,
    run: (
      url = origin + path + '&_rsc=real-refresh',
      method = 'GET',
      rsc = '1',
    ) =>
      handler({
        request: () => ({
          url: () => url,
          method: () => method,
          headers: () => ({ rsc }),
        }),
        fetch,
        fulfill,
        abort,
        fallback,
      } as unknown as Route),
  };
}
it('reads the real RSC body before forwarding, then unregisters without reading Chromium response bodies', async () => {
  const f = fixture();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = vi.fn(async (response: APIResponse) => {
    expect(response).toBe(f.response);
    await barrier;
    return 'real RSC bytes';
  });
  const observation = await observeCalendarRefresh(f.page, path, read);
  const done = f.run();
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  expect(f.fulfill).not.toHaveBeenCalled();
  release();
  await done;
  expect(await observation.result).toBe('real RSC bytes');
  expect(f.fetch).toHaveBeenCalledExactlyOnceWith({ maxRedirects: 0 });
  expect(f.fulfill).toHaveBeenCalledExactlyOnceWith({ response: f.response });
  expect(f.unroute).toHaveBeenCalledExactlyOnceWith(
    '**/*',
    expect.any(Function),
  );
  await f.run();
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(f.fallback).toHaveBeenCalledOnce();
});
it.each([
  [origin + path, 'GET', ''],
  [origin + path, 'POST', '1'],
  [
    origin + '/admin/content-calendar?artist_id=other&month=2036-02',
    'GET',
    '1',
  ],
  [
    origin + '/admin/content-calendar?artist_id=fictional&month=2036-03',
    'GET',
    '1',
  ],
  ['https://other.invalid' + path, 'GET', '1'],
  [origin + '/artist/other/calendar?month=2036-02', 'GET', '1'],
])('leaves unrelated request %s %s %s untouched', async (url, method, rsc) => {
  const f = fixture();
  const read = vi.fn(async () => 'verified');
  const observation = await observeCalendarRefresh(f.page, path, read);
  await f.run(url, method, rsc);
  expect(f.fetch).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(f.fallback).toHaveBeenCalledOnce();
  await f.run(
    origin +
      '/admin/content-calendar?_rsc=fresh&month=2036-02&artist_id=fictional',
  );
  expect(await observation.result).toBe('verified');
});
it('propagates upstream body assertion failure and never manufactures a successful response', async () => {
  const f = fixture();
  const error = new Error('real body assertion failed');
  const observation = await observeCalendarRefresh(f.page, path, async () => {
    throw error;
  });
  const failed = expect(observation.result).rejects.toBe(error);
  await f.run();
  await failed;
  expect(f.fulfill).not.toHaveBeenCalled();
  expect(f.abort).toHaveBeenCalledOnce();
  expect(f.unroute).toHaveBeenCalledOnce();
});
