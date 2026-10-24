// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PWA } from '@/config/pwa';

const mock = vi.hoisted(() => ({
  construct: vi.fn(),
  install: vi.fn(),
  activate: vi.fn(),
  fetch: vi.fn(),
  match: vi.fn(),
}));
vi.mock('serwist', () => ({
  Serwist: class {
    constructor(options: unknown) {
      mock.construct(options);
    }
    handleInstall = mock.install;
    handleActivate = mock.activate;
    handleFetch = mock.fetch;
    matchPrecache = mock.match;
  },
}));
const origin = 'https://app.example';
const asset = `${origin}/_next/static/chunks/abc.js`;
let listeners: Record<string, (event: never) => void>;
let network: ReturnType<typeof vi.fn>;
let storage: {
  keys: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  listeners = {};
  storage = { keys: vi.fn().mockResolvedValue([]), delete: vi.fn() };
  network = vi.fn();
  vi.stubGlobal('fetch', network);
  vi.stubGlobal('self', {
    location: { origin },
    caches: storage,
    __SW_MANIFEST: [
      { url: asset, revision: null },
      { url: '/offline.html', revision: 'digest' },
      { url: '/private', revision: 'unsafe' },
    ],
    addEventListener: (type: string, listener: (event: never) => void) => {
      listeners[type] = listener;
    },
  });
  await import('@/worker/sw');
});
afterEach(() => vi.unstubAllGlobals());

it('registers only install/activate/fetch, never CACHE_URLS, push or subscriptions', () => {
  expect(Object.keys(listeners)).toEqual(['install', 'activate', 'fetch']);
  const options = mock.construct.mock.calls[0]![0];
  expect(options.precacheEntries).toHaveLength(2);
  expect(options.runtimeCaching).toEqual([]);
  expect(options.navigationPreload).toBe(false);
  expect(options.precacheOptions).toMatchObject({
    cacheName: PWA.cacheName,
    cleanURLs: false,
    directoryIndex: null,
    ignoreURLParametersMatching: [],
    fallbackToNetwork: false,
  });
});
it('makes precache network requests credential-free and rejects redirects', async () => {
  const plugin = mock.construct.mock.calls[0]![0].precacheOptions.plugins[0];
  const request: Request = await plugin.requestWillFetch({
    request: new Request(asset),
  });
  expect(request.credentials).toBe('omit');
  expect(request.redirect).toBe('error');
  expect(request.cache).toBe('reload');
});
it('delegates only exact public manifest GETs to Serwist', () => {
  const event = { request: new Request(asset) };
  listeners.fetch!(event as never);
  expect(mock.fetch).toHaveBeenCalledWith(event);
  for (const request of [
    new Request(`${asset}?_rsc=1`),
    new Request(asset, { headers: { rsc: '1' } }),
    new Request(`${origin}/api/onboarding`),
    new Request(`${origin}/start`),
    new Request(`${origin}/_next/static/chunks/unknown.js`),
    new Request(`${origin}/private/image.jpg`),
  ])
    listeners.fetch!({ request } as never);
  expect(mock.fetch).toHaveBeenCalledOnce();
  expect(network).not.toHaveBeenCalled();
});
it('never caches online document responses, even private HTML', async () => {
  const request = new Request(`${origin}/onboarding/install`);
  Object.defineProperties(request, {
    mode: { value: 'navigate' },
    destination: { value: 'document' },
  });
  const response = new Response('private person', {
    headers: { 'cache-control': 'private, no-store' },
  });
  network.mockResolvedValue(response);
  const respondWith = vi.fn();
  listeners.fetch!({ request, respondWith } as never);
  expect(await respondWith.mock.calls[0]![0]).toBe(response);
  expect(mock.fetch).not.toHaveBeenCalled();
  expect(mock.match).not.toHaveBeenCalled();
});
it('returns only the explicit static offline page on document network failure', async () => {
  const request = new Request(`${origin}/onboarding/install`);
  Object.defineProperties(request, {
    mode: { value: 'navigate' },
    destination: { value: 'document' },
  });
  network.mockRejectedValue(new Error('offline'));
  const fallback = new Response('offline page');
  mock.match.mockResolvedValue(fallback);
  const respondWith = vi.fn();
  listeners.fetch!({ request, respondWith } as never);
  expect(await respondWith.mock.calls[0]![0]).toBe(fallback);
  expect(mock.match).toHaveBeenCalledWith(PWA.offlineUrl);
});
it('returns network error if static offline cache is unavailable', async () => {
  const request = new Request(`${origin}/start`);
  Object.defineProperties(request, {
    mode: { value: 'navigate' },
    destination: { value: 'document' },
  });
  network.mockRejectedValue(new Error('offline'));
  mock.match.mockResolvedValue(undefined);
  const respondWith = vi.fn();
  listeners.fetch!({ request, respondWith } as never);
  const response: Response = await respondWith.mock.calls[0]![0];
  expect(response.type).toBe('error');
});
it('delegates entry cleanup to Serwist and waits for application-version cleanup on activation', async () => {
  storage.keys.mockResolvedValue([
    PWA.cacheName,
    `${PWA.cachePrefix}v0`,
    'unrelated',
  ]);
  storage.delete.mockResolvedValue(true);
  const event = { waitUntil: vi.fn() };
  listeners.activate!(event as never);
  expect(mock.activate).toHaveBeenCalledWith(event);
  await event.waitUntil.mock.calls[0]![0];
  expect(storage.delete).toHaveBeenCalledExactlyOnceWith(
    `${PWA.cachePrefix}v0`,
  );
});
