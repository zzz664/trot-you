import { expect, type Page } from '@playwright/test';

export async function captureSettledAttendancePoints(page: Page, path: string) {
  const main = page.locator('main');
  await main
    .locator('[data-testid="attendance-points-content"], [role="alert"]')
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
