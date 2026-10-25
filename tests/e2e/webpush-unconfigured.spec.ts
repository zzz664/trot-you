import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { FONT_SCALE_COOKIE } from '../../src/config/constants';
import { routes } from '../../src/config/routes';

const messages: typeof import('../../src/messages/ko.json') = JSON.parse(
  readFileSync(new URL('../../src/messages/ko.json', import.meta.url), 'utf8'),
);
const copy = messages.notifications;

test('keyless notification APIs fail closed without subscription or delivery success', async ({
  request,
}) => {
  for (const method of ['GET', 'POST', 'DELETE'] as const) {
    const response = await request.fetch(routes.pushSubscription, {
      method,
      ...(method === 'GET' ? {} : { data: {} }),
    });
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(response.headers()['cache-control']).toContain('no-store');
  }
});

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`${scale} ${width}: keyless notification settings show real Retry and Back`, async ({
      page,
      context,
    }, info) => {
      await context.addCookies([
        {
          name: FONT_SCALE_COOKIE,
          value: scale,
          url: 'http://127.0.0.1:3100',
          sameSite: 'Lax',
        },
      ]);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(routes.notifications);
      const main = page.getByRole('main');
      await expect(
        main.getByRole('heading', { name: copy.title, exact: true }),
      ).toBeVisible();
      await expect(main.getByRole('alert')).toHaveText(
        copy.errors.SETUP_NOT_READY,
      );
      await expect(main.getByRole('checkbox')).toHaveCount(0);
      await expect(page.locator('html')).toHaveAttribute(
        'data-font-scale',
        scale,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`webpush-keyless-initial-${scale}-${width}.png`),
        fullPage: true,
      });
      await main
        .getByRole('button', { name: messages.ui.retry, exact: true })
        .click();
      await expect(main.getByRole('alert')).toHaveText(
        copy.errors.SETUP_NOT_READY,
      );
      await main.getByRole('link', { name: copy.back, exact: true }).click();
      await expect(page).toHaveURL('http://127.0.0.1:3100/');
    });
