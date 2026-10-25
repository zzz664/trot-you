/// <reference lib="webworker" />
import { Serwist, type PrecacheEntry } from 'serwist';
import { PWA } from '@/config/pwa';
import { openWebPush, respondWebPushCapability, showWebPush } from './webpush';
import {
  isOfflineDocumentRequest,
  isPublicPrecacheRequest,
  isPublicPrecacheUrl,
  isSafePrecacheResponse,
  removeOldPublicCaches,
} from './cache-policy';

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: PrecacheEntry[];
};

const origin = self.location.origin;
// Build-time and runtime allowlists are intentionally independent barriers.
const entries = self.__SW_MANIFEST.filter((entry) =>
  isPublicPrecacheUrl(entry.url, origin),
);
const manifestUrls = new Set(
  entries.map((entry) => new URL(entry.url, origin).href),
);
const serwist = new Serwist({
  precacheEntries: entries,
  precacheOptions: {
    cacheName: PWA.cacheName,
    cleanURLs: false,
    directoryIndex: null,
    ignoreURLParametersMatching: [],
    // Never fetch missing precache entries with a signed-in page's cookies.
    fallbackToNetwork: false,
    plugins: [
      {
        requestWillFetch: async ({ request }) =>
          new Request(request, {
            credentials: 'omit',
            redirect: 'error',
            cache: 'reload',
          }),
        cacheWillUpdate: async ({ request, response }) =>
          isSafePrecacheResponse(request, response, origin) ? response : null,
      },
    ],
  },
  clientsClaim: true,
  skipWaiting: false,
  navigationPreload: false,
  disableDevLogs: true,
  // Do not import defaultCache: its broad routes include private HTML/RSC.
  runtimeCaching: [],
});

self.addEventListener('install', serwist.handleInstall);
self.addEventListener('activate', (event) => {
  // Serwist removes stale entries in the current cache; delete only our old
  // schema-version caches, never caches owned by another application.
  void serwist.handleActivate(event);
  event.waitUntil(removeOldPublicCaches(self.caches));
});
self.addEventListener('fetch', (event) => {
  if (isPublicPrecacheRequest(event.request, origin, manifestUrls)) {
    serwist.handleFetch(event);
  } else if (isOfflineDocumentRequest(event.request, origin)) {
    // Network responses are returned directly and NEVER written to a cache.
    // APIs/OAuth/RSC/media bypass this handler completely.
    event.respondWith(
      fetch(event.request).catch(async () => {
        const offline = await serwist.matchPrecache(PWA.offlineUrl);
        return offline ?? Response.error();
      }),
    );
  }
});
self.addEventListener('push', (event) => {
  let raw: string | null = null;
  try {
    raw = event.data?.text() ?? null;
  } catch {
    // A damaged payload cannot inject arbitrary notification text or URLs.
  }
  event.waitUntil(showWebPush(self.registration, raw));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openWebPush(self.clients, origin, event.notification.data));
});
self.addEventListener('message', respondWebPushCapability);
// No CACHE_URLS or pushsubscriptionchange auto-enrollment, credential storage,
// background registration or notification receipt/read acknowledgement.
