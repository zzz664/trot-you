import type { Page } from '@playwright/test';

// Event/month content and its notice preferences load independently. Wait for
// the rendered preference state before Chromium measures full-page dimensions,
// otherwise a late panel expansion can truncate an otherwise valid screenshot.
// Admin/loading/revoked pages have no panel and keep their asserted state.
export async function captureSettledSchedulePage(
  page: Pick<Page, 'getByRole' | 'screenshot'>,
  path: string,
) {
  const controls = page
    .getByRole('main')
    .getByTestId('schedule-notice-controls');
  if ((await controls.count()) > 0) {
    await controls
      .locator('[data-schedule-preference]')
      .waitFor({ state: 'visible' });
    await controls.getByRole('status').waitFor({ state: 'hidden' });
  }
  await page.screenshot({ path, fullPage: true });
}
