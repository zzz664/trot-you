import { expect, type Page } from '@playwright/test';

// The board, list, detail and editor must all finish rendering before
// Chromium measures the full document. Deliberate loading screenshots opt out.
export async function captureSettledCommunityPosts(page: Page, path: string) {
  const main = page.locator('main');
  // A false busy flag alone can precede the data commit by a render turn.
  // Require a loaded list/detail/editor or explicit error, never a blank shell.
  await main
    .locator(
      '[data-testid="community-post-list"], [data-testid="community-post-detail"], [data-testid="community-post-form"], [role="alert"], p[role="status"]',
    )
    .first()
    .waitFor({ state: 'attached' });
  // A mounted post starts its separate interaction read after the parent data
  // commit. Wait for its verified snapshot rather than capturing that effect gap.
  if (await main.getByTestId('community-post-detail').count())
    await main
      .locator(
        '[data-testid="community-interactions-content"], [data-testid="community-interactions-recovery"], [role="alert"]',
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
