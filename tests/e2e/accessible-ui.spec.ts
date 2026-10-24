import { expect, test } from '@playwright/test';
import { FONT_SCALE_COOKIE } from '../../src/config/constants';
import { routes } from '../../src/config/routes';
import messages from '../../src/messages/ko.json' with { type: 'json' };

for (const width of [360, 414]) {
  for (const scale of ['normal', 'large', 'xlarge']) {
    test(`accessible UI: ${scale} at ${width}px`, async ({
      page,
      context,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 896 });
      await context.addCookies([
        { name: FONT_SCALE_COOKIE, value: scale, url: 'http://127.0.0.1:3100' },
      ]);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(routes.uiPreview);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        messages.uiPreview.title,
      );
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        'content',
        'noindex, nofollow',
      );
      const input = page.getByRole('textbox', {
        name: messages.uiPreview.inputLabel,
      });
      await expect(input).toHaveAccessibleDescription(
        `${messages.uiPreview.inputHint} ${messages.uiPreview.inputError}`,
      );
      await input.fill('점검');
      expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(56);
      for (const button of await page.getByRole('button').all()) {
        const box = (await button.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(48);
        expect(box.width).toBeGreaterThanOrEqual(48);
      }
      await expect(
        page.getByRole('button', { name: messages.uiPreview.loadingButton }),
      ).toBeDisabled();
      await page
        .getByRole('button', { name: messages.ui.retry, exact: true })
        .click();
      await expect(
        page.getByText(messages.uiPreview.retryResult),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`ui-${scale}-${width}.png`),
        fullPage: true,
      });

      const opener = page.getByRole('button', {
        name: messages.uiPreview.openDialog,
        exact: true,
      });
      await opener.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', {
        name: messages.uiPreview.dialogTitle,
      });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAccessibleDescription(
        messages.uiPreview.dialogDescription,
      );
      const cancel = dialog.getByRole('button', {
        name: messages.ui.cancel,
        exact: true,
      });
      await expect(cancel).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(
        dialog.getByRole('button', { name: messages.ui.close, exact: true }),
      ).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(cancel).toBeFocused();
      await page.screenshot({
        path: testInfo.outputPath(`dialog-${scale}-${width}.png`),
        fullPage: true,
      });
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expect(
        page.getByText(messages.uiPreview.resultCanceled),
      ).toBeVisible();

      const queue = page.getByRole('button', {
        name: messages.uiPreview.openQueue,
        exact: true,
      });
      await queue.click();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await page
        .getByRole('button', { name: messages.ui.confirm, exact: true })
        .click();
      await expect(page.getByRole('dialog')).toHaveAccessibleName(
        messages.uiPreview.secondTitle,
      );
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await expect(
        page.getByRole('button', { name: messages.ui.cancel, exact: true }),
      ).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(queue).toBeFocused();
      await expect(page.getByRole('dialog')).toHaveCount(0);

      const cancelQueued = page.getByRole('button', {
        name: messages.uiPreview.cancelQueued,
        exact: true,
      });
      await cancelQueued.click();
      await page
        .getByRole('button', { name: messages.ui.close, exact: true })
        .click();
      await expect(cancelQueued).toBeFocused();
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await opener.click();
      const enlarged = page.getByRole('dialog');
      expect(
        await enlarged.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await enlarged
        .getByRole('button', { name: messages.ui.close, exact: true })
        .click();
      await expect(opener).toBeFocused();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(page.locator('.ui-loading .ui-spinner')).toHaveCSS(
        'animation-name',
        'none',
      );
      expect(errors).toEqual([]);
    });
  }
}

test('outside dismissal returns focus and direct-entry Back uses safe home fallback', async ({
  page,
}) => {
  await page.goto('data:text/html,external-history-entry');
  await page.goto(routes.uiPreview);
  const opener = page.getByRole('button', {
    name: messages.uiPreview.openDialog,
    exact: true,
  });
  await opener.click();
  await page.mouse.click(2, 2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
  const historyLength = await page.evaluate(() => history.length);
  await page
    .getByRole('button', { name: messages.ui.back, exact: true })
    .click();
  await expect(page).toHaveURL(/\/start\?/);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
});
