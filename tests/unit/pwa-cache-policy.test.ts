// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  isOfflineDocumentRequest,
  isPublicPrecacheRequest,
  isPublicPrecacheUrl,
  isSafePrecacheResponse,
  removeOldPublicCaches,
} from '@/worker/cache-policy';
import { PWA } from '@/config/pwa';

const origin = 'https://app.example';
const asset = `${origin}/_next/static/chunks/a-hash123.js`;
const manifest = new Set([asset, `${origin}${PWA.offlineUrl}`]);
const documentRequest = (url: string) => {
  const request = new Request(url);
  Object.defineProperties(request, {
    mode: { value: 'navigate' },
    destination: { value: 'document' },
  });
  return request;
};

it.each([
  '/_next/static/chunks/a-hash123.js',
  '/_next/static/chunks/aaa.css',
  '/_next/static/buildID/_buildManifest.js',
  PWA.offlineUrl,
])('allows only public static precache URL %s', (path) => {
  expect(isPublicPrecacheUrl(path, origin)).toBe(true);
});
it.each([
  '/',
  '/onboarding/install',
  '/start',
  '/api/auth/callback',
  '/api/onboarding',
  '/artists/singer',
  '/private/audio.mp3',
  '/_next/static/chunks/x.js.map',
  '/_next/static/media/photo.jpg',
  '/_next/static/chunks/x.json',
  '/_next/static/chunks/x.js?_rsc=1',
  '/_next/static/chunks/x.js?utm_source=test',
  '/offline.html?name=private',
  '/offline.html#private',
  'https://external.example/_next/static/chunks/x.js',
  'https://user:secret@app.example/offline.html',
])('rejects unsafe precache URL %s', (path) => {
  expect(isPublicPrecacheUrl(path, origin)).toBe(false);
});

it('requires exact manifest membership and GET without query normalization', () => {
  expect(isPublicPrecacheRequest(new Request(asset), origin, manifest)).toBe(
    true,
  );
  expect(
    isPublicPrecacheRequest(
      new Request(`${asset}?utm_source=x`),
      origin,
      manifest,
    ),
  ).toBe(false);
  expect(
    isPublicPrecacheRequest(
      new Request(asset, { method: 'POST' }),
      origin,
      manifest,
    ),
  ).toBe(false);
  expect(isPublicPrecacheRequest(new Request(asset), origin, new Set())).toBe(
    false,
  );
});
it.each(PWA.privateRequestHeaders)(
  'bypasses private header %s even at an allowed asset URL',
  (header) => {
    const request = new Request(asset, { headers: { [header]: 'true' } });
    expect(isPublicPrecacheRequest(request, origin, manifest)).toBe(false);
  },
);

it('only uses offline fallback for actual same-origin document navigations', () => {
  expect(
    isOfflineDocumentRequest(
      documentRequest(`${origin}/onboarding/install`),
      origin,
    ),
  ).toBe(true);
  expect(
    isOfflineDocumentRequest(
      new Request(`${origin}/onboarding/install`),
      origin,
    ),
  ).toBe(false);
  expect(
    isOfflineDocumentRequest(
      documentRequest('https://elsewhere.example/'),
      origin,
    ),
  ).toBe(false);
  expect(
    isOfflineDocumentRequest(
      documentRequest(`${origin}/api/auth/callback?code=x`),
      origin,
    ),
  ).toBe(false);
  expect(
    isOfflineDocumentRequest(documentRequest(`${origin}/_next/image`), origin),
  ).toBe(false);
  const rsc = documentRequest(`${origin}/onboarding/install`);
  rsc.headers.set('rsc', '1');
  expect(isOfflineDocumentRequest(rsc, origin)).toBe(false);
});

const safeResponse = (headers: Record<string, string> = {}) =>
  new Response('public', {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
      ...headers,
    },
  });
it('accepts only a non-private matching static response type', () => {
  expect(
    isSafePrecacheResponse(new Request(asset), safeResponse(), origin),
  ).toBe(true);
  expect(
    isSafePrecacheResponse(
      new Request(`${origin}${PWA.offlineUrl}`),
      safeResponse({ 'content-type': 'text/html' }),
      origin,
    ),
  ).toBe(true);
  expect(
    isSafePrecacheResponse(
      new Request(`${origin}/_next/static/chunks/a.css`),
      safeResponse({ 'content-type': 'text/css' }),
      origin,
    ),
  ).toBe(true);
});
it.each([
  { 'cache-control': 'private' },
  { 'cache-control': 'no-store' },
  { vary: 'Cookie' },
  { vary: 'RSC, Next-Router-State-Tree' },
  { vary: '*' },
  { 'set-cookie': 'session=private' },
  { 'content-type': 'text/x-component' },
  { 'content-type': 'text/html' },
])('rejects personalized or incorrect response headers %j', (headers) => {
  expect(
    isSafePrecacheResponse(new Request(asset), safeResponse(headers), origin),
  ).toBe(false);
});
it('rejects redirected/opaque/error/foreign responses', () => {
  for (const value of [
    { redirected: true },
    { type: 'opaque' },
    { type: 'opaqueredirect' },
    { url: `${origin}/start` },
    { url: 'https://external.example/' },
    { status: 404 },
  ]) {
    const response = safeResponse();
    for (const [key, property] of Object.entries(value))
      Object.defineProperty(response, key, { value: property });
    expect(isSafePrecacheResponse(new Request(asset), response, origin)).toBe(
      false,
    );
  }
});

describe('versioned cache cleanup', () => {
  it('deletes only old application-owned versions and preserves active/unrelated caches', async () => {
    const storage = {
      keys: vi
        .fn()
        .mockResolvedValue([
          PWA.cacheName,
          `${PWA.cachePrefix}v0`,
          `${PWA.cachePrefix}obsolete`,
          'another-app-precache-v1',
        ]),
      delete: vi.fn().mockResolvedValue(true),
    } as unknown as CacheStorage;
    await removeOldPublicCaches(storage);
    expect(storage.delete).toHaveBeenCalledTimes(2);
    expect(storage.delete).toHaveBeenCalledWith(`${PWA.cachePrefix}v0`);
    expect(storage.delete).toHaveBeenCalledWith(`${PWA.cachePrefix}obsolete`);
    expect(storage.delete).not.toHaveBeenCalledWith(PWA.cacheName);
    expect(storage.delete).not.toHaveBeenCalledWith('another-app-precache-v1');
  });
  it('propagates storage failure rather than pretending cleanup succeeded', async () => {
    await expect(
      removeOldPublicCaches({
        keys: () => Promise.reject(new Error('storage unavailable')),
      } as unknown as CacheStorage),
    ).rejects.toThrow('storage unavailable');
  });
});
