// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { Page, Route, APIResponse } from '@playwright/test';
import { observeScheduleSave } from '../e2e/schedules/response-capture';

function fixture() {
  let handler!: (route: Route) => Promise<void>;
  const register = vi.fn(async (_url, callback) => {
    handler = callback;
  });
  const response = { fixture: true } as unknown as APIResponse;
  const fetch = vi.fn(async () => response);
  const fulfill = vi.fn(async () => undefined);
  const abort = vi.fn(async () => undefined);
  return {
    page: { route: register } as unknown as Pick<Page, 'route'>,
    register,
    response,
    fetch,
    fulfill,
    abort,
    run: () => handler({ fetch, fulfill, abort } as unknown as Route),
  };
}
it('captures real response before forwarding navigation-triggering acknowledgment, once', async () => {
  const f = fixture();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = vi.fn(async (response: APIResponse) => {
    expect(response).toBe(f.response);
    await barrier;
    return { id: 'verified-real-id' };
  });
  const saved = await observeScheduleSave(
    f.page,
    '/api/admin/schedules/save',
    read,
  );
  const done = f.run();
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  expect(f.fulfill).not.toHaveBeenCalled();
  release();
  await done;
  expect(await saved.result).toEqual({ id: 'verified-real-id' });
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(f.fulfill).toHaveBeenCalledExactlyOnceWith({ response: f.response });
  expect(f.register).toHaveBeenCalledWith(
    '**/api/admin/schedules/save',
    expect.any(Function),
    { times: 1 },
  );
  expect(f.abort).not.toHaveBeenCalled();
});
it('preserves body assertion failure instead of manufacturing a successful UI response', async () => {
  const f = fixture();
  const error = new Error('assertion failure');
  const saved = await observeScheduleSave(
    f.page,
    '/api/admin/schedules/save',
    async () => {
      throw error;
    },
  );
  const rejected = expect(saved.result).rejects.toBe(error);
  await f.run();
  await rejected;
  expect(f.fulfill).not.toHaveBeenCalled();
  expect(f.abort).toHaveBeenCalledOnce();
});
