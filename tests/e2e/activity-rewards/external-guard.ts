import type { BrowserContext } from '@playwright/test';

// A denial-only guard: allowed traffic belongs to page-level response handlers
// or the browser, never a competing context-level continue/fulfill callback.
export async function blockActivityExternalRequests(
  context: Pick<BrowserContext, 'route'>,
  allowedOrigins: readonly string[],
) {
  const requests: string[] = [];
  await context.route(
    (url) => !allowedOrigins.includes(url.origin),
    async (route) => {
      requests.push(new URL(route.request().url()).origin);
      await route.abort('blockedbyclient');
    },
  );
  return requests;
}
