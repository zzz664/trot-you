import type { APIResponse, Page } from '@playwright/test';

// Preserve the real request, authenticated cookies, response and UI navigation.
// Capture the body before forwarding the response: Chromium may discard a page
// Response body after the app navigates, even when waitForResponse has resolved.
export async function observeCalendarMutation<T>(
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
