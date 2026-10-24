import { PWA } from '@/config/pwa';

export function isPublicPrecacheUrl(value: string, origin: string): boolean {
  const url = new URL(value, origin);
  return (
    url.origin === origin &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password &&
    (url.pathname === PWA.offlineUrl ||
      PWA.staticAssetPattern.test(url.pathname))
  );
}

export function isPublicPrecacheRequest(
  request: Request,
  origin: string,
  manifestUrls: ReadonlySet<string>,
): boolean {
  return (
    request.method === 'GET' &&
    isPublicPrecacheUrl(request.url, origin) &&
    manifestUrls.has(request.url) &&
    !PWA.privateRequestHeaders.some((header) => request.headers.has(header))
  );
}

export function isOfflineDocumentRequest(
  request: Request,
  origin: string,
): boolean {
  const url = new URL(request.url);
  return (
    request.method === 'GET' &&
    request.mode === 'navigate' &&
    request.destination === 'document' &&
    url.origin === origin &&
    !url.pathname.startsWith(PWA.apiPrefix) &&
    !url.pathname.startsWith(PWA.nextPrefix) &&
    !PWA.privateRequestHeaders.some((header) => request.headers.has(header))
  );
}

export function isSafePrecacheResponse(
  request: Request,
  response: Response,
  origin: string,
): boolean {
  const url = new URL(request.url);
  const contentType = response.headers.get('content-type') ?? '';
  const expectedType =
    url.pathname === PWA.offlineUrl
      ? /^text\/html(?:;|$)/i
      : url.pathname.endsWith('.css')
        ? /^text\/css(?:;|$)/i
        : /^(?:text|application)\/(?:javascript|ecmascript)(?:;|$)/i;
  return (
    isPublicPrecacheUrl(request.url, origin) &&
    response.status === PWA.successStatus &&
    response.type !== 'opaque' &&
    response.type !== 'opaqueredirect' &&
    !response.redirected &&
    (!response.url || response.url === request.url) &&
    !response.headers.has('set-cookie') &&
    !/private|no-store/i.test(response.headers.get('cache-control') ?? '') &&
    !/\*|cookie|authorization|rsc|next-router/i.test(
      response.headers.get('vary') ?? '',
    ) &&
    expectedType.test(contentType)
  );
}

export async function removeOldPublicCaches(storage: CacheStorage) {
  const names = await storage.keys();
  await Promise.all(
    names
      .filter(
        (name) => name.startsWith(PWA.cachePrefix) && name !== PWA.cacheName,
      )
      .map((name) => storage.delete(name)),
  );
}
