import type { BrowserContext, Route } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import { blockActivityExternalRequests } from '../e2e/activity-rewards/external-guard';

const allowedOrigins = ['http://127.0.0.1:3100', 'http://127.0.0.1:54321'];
async function register() {
  const route = vi.fn<BrowserContext['route']>().mockResolvedValue({
    dispose: async () => {},
    [Symbol.asyncDispose]: async () => {},
  });
  const denied = await blockActivityExternalRequests({ route }, allowedOrigins);
  const [matcher, handler] = route.mock.calls[0]!;
  if (typeof matcher !== 'function')
    throw new Error('Expected origin predicate');
  return { denied, matcher, handler };
}
function fakeRoute(url: string) {
  const abort = vi.fn<Route['abort']>().mockResolvedValue();
  const continueRequest = vi.fn<Route['continue']>();
  const route = {
    request: () => ({ url: () => url }),
    abort,
    continue: continueRequest,
  } as unknown as Route;
  return { route, abort, continueRequest };
}

describe('activity browser denial-only external guard', () => {
  it('does not match app or database requests, including private reads and RSC navigation', async () => {
    const { matcher, denied } = await register();
    for (const path of [
      '/api/points/activity',
      '/points?_rsc=fixture',
      '/auth/v1/user',
    ])
      for (const origin of allowedOrigins)
        expect(matcher(new URL(path, origin))).toBe(false);
    expect(denied).toEqual([]);
  });

  it('matches origins outside the exact allowlist', async () => {
    const { matcher } = await register();
    for (const url of [
      'https://example.invalid/asset',
      'https://127.0.0.1:3100/asset',
      'http://127.0.0.1:3101/asset',
      'http://localhost:3100/asset',
    ])
      expect(matcher(new URL(url))).toBe(true);
  });

  it('records and aborts matched external traffic without continuing it', async () => {
    const { handler, denied } = await register();
    const { route, abort, continueRequest } = fakeRoute(
      'https://example.invalid/asset',
    );
    await handler(route, route.request());
    expect(denied).toEqual(['https://example.invalid']);
    expect(abort).toHaveBeenCalledExactlyOnceWith('blockedbyclient');
    expect(continueRequest).not.toHaveBeenCalled();
  });

  it('propagates terminal route errors instead of suppressing them', async () => {
    const { handler } = await register();
    const { route, abort } = fakeRoute('https://example.invalid/asset');
    const failure = new Error('synthetic route failure');
    abort.mockRejectedValue(failure);
    await expect(handler(route, route.request())).rejects.toBe(failure);
  });
});
