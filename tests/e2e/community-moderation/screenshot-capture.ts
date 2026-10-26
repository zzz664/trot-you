import { expect, type Page } from '@playwright/test';

// The moderation and parent snapshot must finish rendering before
// Chromium measures the full document. Deliberate loading screenshots opt out.
export async function captureSettledCommunityModeration(
  page: Page,
  path: string,
) {
  const main = page.locator('main');
  // A false busy flag alone can precede the data commit by a render turn.
  // Require a loaded list/detail/editor or explicit error, never a blank shell.
  await main
    .locator(
      '[data-testid="community-moderation-content"], [data-testid="community-report-notices"], [data-testid="community-report-panel"], [data-testid="community-report-recovery"], [data-testid="community-interactions-content"], [data-testid="community-post-list"], [role="alert"], p[role="status"]',
    )
    .first()
    .waitFor({ state: 'attached' });
  await expect(main.locator('.ui-loading')).toHaveCount(0);
  await expect(main).not.toHaveAttribute('aria-busy', 'true');
  await expect(main.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await page.screenshot({ path, fullPage: true });
}
