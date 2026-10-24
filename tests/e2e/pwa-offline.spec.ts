import { expect, test, type Page } from '@playwright/test';
import { PWA } from '../../src/config/pwa';
import messages from '../../src/messages/ko.json' with { type: 'json' };

// This suite uses the actual production worker and localhost Chromium. Do not
// route/fulfill worker requests or grant any browser notification permission.
async function ready(page: Page) {
  await page.goto('/start');
  await page.waitForFunction(
    () => navigator.serviceWorker.controller?.state === 'activated',
  );
  const worker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return {
      scope: registration.scope,
      script: registration.active?.scriptURL,
    };
  });
  expect(worker.scope).toBe('http://127.0.0.1:3100/');
  expect(worker.script).toBe(`http://127.0.0.1:3100${PWA.workerUrl}`);
}
async function cacheUrls(page: Page) {
  return page.evaluate(async (cacheName) => {
    const cache = await caches.open(cacheName);
    return (await cache.keys()).map((request) => request.url).sort();
  }, PWA.cacheName);
}
function assertStaticOnly(urls: string[]) {
  expect(urls.length).toBeGreaterThan(1);
  for (const value of urls) {
    const url = new URL(value);
    expect(url.origin).toBe('http://127.0.0.1:3100');
    if (url.pathname === PWA.offlineUrl) {
      expect([...url.searchParams.keys()]).toEqual(['__WB_REVISION__']);
    } else {
      expect(PWA.staticAssetPattern.test(url.pathname)).toBe(true);
      expect(url.search).toBe('');
    }
  }
}

test('real manifest/icons and credential-free static worker installation', async ({
  page,
  context,
  request,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'pwaPermissionAtDocumentStart', {
      value: 'Notification' in window ? Notification.permission : null,
    });
  });
  const workerRequests: Promise<{ url: string; cookie: string | undefined }>[] =
    [];
  context.on('request', (event) => {
    if (event.serviceWorker())
      workerRequests.push(
        event
          .allHeaders()
          .then((headers) => ({ url: event.url(), cookie: headers.cookie })),
      );
  });
  await context.addCookies([
    {
      name: 'pwa-private-fixture',
      value: 'never-send-to-precache',
      url: 'http://127.0.0.1:3100',
    },
  ]);
  await ready(page);
  const response = await request.get(PWA.manifestUrl);
  expect(response.status()).toBe(200);
  expect(response.headers()['set-cookie']).toBeUndefined();
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: messages.metadata.title,
    start_url: '/',
    display: 'standalone',
    scope: '/',
  });
  for (const path of [PWA.icon192, PWA.icon512, PWA.appleIcon]) {
    const icon = await request.get(path);
    expect(icon.status()).toBe(200);
    expect(icon.headers()['content-type']).toContain('image/png');
    expect(icon.headers()['set-cookie']).toBeUndefined();
  }
  const worker = await request.get(PWA.workerUrl);
  expect(worker.status()).toBe(200);
  expect(worker.headers()['cache-control']).toContain('no-store');
  expect(worker.headers()['service-worker-allowed']).toBe('/');
  expect(worker.headers()['set-cookie']).toBeUndefined();
  const observed = await Promise.all(workerRequests);
  expect(observed.length).toBeGreaterThan(1);
  expect(observed.every((entry) => !entry.cookie)).toBe(true);
  assertStaticOnly(await cacheUrls(page));
  const permission = await page.evaluate(() => ({
    initial:
      'pwaPermissionAtDocumentStart' in window
        ? window.pwaPermissionAtDocumentStart
        : undefined,
    current: 'Notification' in window ? Notification.permission : null,
  }));
  expect(permission.current).toBe(permission.initial);
});

test('offline shows only public fallback and never returns API/RSC/OAuth/media from cache', async ({
  page,
  context,
}) => {
  await ready(page);
  const before = await cacheUrls(page);
  assertStaticOnly(before);
  const asset = before.find((url) => url.endsWith('.js'))!;
  await context.setOffline(true);
  // Probe from the already-loaded online document: the intentionally stricter
  // offline page CSP blocks all connect-src, which would mask worker behavior.
  const outcomes = await page.evaluate(
    async ({ assetUrl }) => {
      const get = async (url: string, headers?: Record<string, string>) => {
        try {
          const response = await fetch(url, {
            cache: 'no-store',
            ...(headers ? { headers } : {}),
          });
          return { resolved: true, status: response.status };
        } catch {
          return { resolved: false };
        }
      };
      return {
        asset: await get(assetUrl),
        api: await get('/api/onboarding'),
        oauth: await get('/api/auth/callback?code=fictional-offline-code'),
        rsc: await get('/onboarding/install?_rsc=fictional', { RSC: '1' }),
        headerRsc: await get(assetUrl, { RSC: '1' }),
        queryAsset: await get(`${assetUrl}?utm_source=must-not-normalize`),
        media: await get('/private/fictional-preview.mp3'),
        nonManifest: await get('/_next/static/chunks/not-in-manifest.js'),
      };
    },
    { assetUrl: asset },
  );
  expect(outcomes.asset).toEqual({ resolved: true, status: 200 });
  for (const [key, value] of Object.entries(outcomes))
    if (key !== 'asset') expect(value, key).toEqual({ resolved: false });
  expect(await cacheUrls(page)).toEqual(before);
  const navigation = await page.goto('/onboarding/install');
  expect(navigation?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    messages.pwaOffline.title,
  );
  await expect(page.getByText(messages.pwaOffline.privacy)).toBeVisible();
  await context.setOffline(false);
  await page.getByRole('link', { name: messages.pwaOffline.retry }).click();
  await expect(page).toHaveURL(/\/start\?/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    messages.auth.startTitle,
  );
});

test('actual activation removes obsolete entries and older own versions only', async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(
    async ({ current, old }) => {
      await (
        await caches.open(current)
      ).put('/obsolete-fictional-entry', new Response('stale'));
      await (await caches.open(old)).put('/old-fixture', new Response('old'));
      await (
        await caches.open('unrelated-pwa-fixture')
      ).put('/other-fixture', new Response('other'));
      const registration = await navigator.serviceWorker.ready;
      await registration.unregister();
    },
    { current: PWA.cacheName, old: `${PWA.cachePrefix}v0` },
  );
  // A new real registration forces a fresh activation against the seeded cache.
  await page.goto('/start');
  await expect
    .poll(async () =>
      page.evaluate(async (prefix) => {
        const names = await caches.keys();
        const registration = await navigator.serviceWorker.getRegistration();
        return (
          registration?.active?.state === 'activated' &&
          !names.includes(`${prefix}v0`)
        );
      }, PWA.cachePrefix),
    )
    .toBe(true);
  const names = await page.evaluate(() => caches.keys());
  expect(names).toContain(PWA.cacheName);
  expect(names).toContain('unrelated-pwa-fixture');
  assertStaticOnly(await cacheUrls(page));
});

for (const width of [360, 414]) {
  test(`static offline accessibility at ${width}px`, async ({
    page,
    context,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 896 });
    await ready(page);
    await context.setOffline(true);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      messages.pwaOffline.title,
    );
    const retry = page.getByRole('link', { name: messages.pwaOffline.retry });
    expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`offline-${width}.png`),
      fullPage: true,
    });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
