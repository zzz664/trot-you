import type { APIResponse, Page, Route } from '@playwright/test';

// Preserve the real request, authenticated cookies, response and UI navigation.
// Capture the body before forwarding the response: Chromium may discard a page
// Response body after the app navigates, even when waitForResponse has resolved.
export async function observeCommunityMutation<T>(
  page: Pick<Page, 'route'>,
  path: string,
  read: (response: APIResponse) => Promise<T>,
) {
  let accept!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const result = new Promise<T>((resolve, fail) => {
    accept = resolve;
    reject = fail;
  });
  await page.route(
    `**${path}`,
    async (route) => {
      try {
        const response = await route.fetch();
        const captured = await read(response);
        await route.fulfill({ response });
        accept(captured);
      } catch (error) {
        reject(error);
        await route.abort().catch(() => undefined);
      }
    },
    { times: 1 },
  );
  return { result };
}

// A completed Next refresh may cancel Chromium's streamed response body even
// without document navigation. Read the real upstream RSC body before forwarding
// it, and match the mounted route/query rather than any unrelated prefetch.
export async function observeCommunityRefresh<T>(
  page: Pick<Page, 'route' | 'unroute' | 'url'>,
  path: string,
  read: (response: APIResponse) => Promise<T>,
) {
  const canonical = (value: URL) => {
    value.searchParams.delete('_rsc');
    value.searchParams.sort();
    return value.href;
  };
  const expected = canonical(new URL(path, page.url()));
  let accept!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const result = new Promise<T>((resolve, fail) => {
    accept = resolve;
    reject = fail;
  });
  let captured = false;
  const handle = async (route: Route) => {
    const request = route.request();
    if (
      captured ||
      request.method() !== 'GET' ||
      request.headers()['rsc'] !== '1' ||
      canonical(new URL(request.url())) !== expected
    ) {
      await route.fallback();
      return;
    }
    captured = true;
    try {
      const response = await route.fetch({ maxRedirects: 0 });
      const body = await read(response);
      await route.fulfill({ response });
      await page.unroute('**/*', handle);
      accept(body);
    } catch (error) {
      reject(error);
      await route.abort().catch(() => undefined);
      await page.unroute('**/*', handle);
    }
  };
  await page.route('**/*', handle);
  return { result };
}
