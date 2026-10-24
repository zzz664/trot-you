import { expect, test } from '@playwright/test';
import { FONT_SCALE_COOKIE } from '../../src/config/constants';
import { routes } from '../../src/config/routes';
import messages from '../../src/messages/ko.json' with { type: 'json' };

for (const width of [360, 414]) {
  for (const scale of ['normal', 'large', 'xlarge']) {
    test(`foundation: ${scale} at ${width}px`, async ({
      page,
      context,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 896 });
      await context.addCookies([
        { name: FONT_SCALE_COOKIE, value: scale, url: 'http://127.0.0.1:3100' },
      ]);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(routes.home);
      await expect(page).toHaveURL(/\/start\?/);
      await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
      await expect(page.locator('html')).toHaveAttribute(
        'data-font-scale',
        scale,
      );
      const expectedSize = { normal: '18px', large: '21px', xlarge: '25px' }[
        scale
      ];
      await expect(page.locator('body')).toHaveCSS('font-size', expectedSize!);
      await expect(page.locator('body')).toHaveCSS('word-break', 'keep-all');
      await expect(page.locator('body')).toHaveCSS('overflow-wrap', 'anywhere');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        messages.auth.startTitle,
      );
      await expect(page.getByText(messages.auth.unavailable)).toBeVisible();
      const login = page.getByRole('button', { name: messages.auth.login });
      await expect(login).toBeDisabled();
      await expect(login).toHaveAccessibleDescription(
        messages.auth.unavailable,
      );
      expect((await login.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute(
        'data-font-scale',
        scale,
      );
      expect(errors).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`${scale}-${width}.png`),
        fullPage: true,
      });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    });
  }
}
