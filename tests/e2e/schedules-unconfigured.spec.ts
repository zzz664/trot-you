import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { FONT_SCALE_COOKIE } from '../../src/config/constants';
import {
  routes,
  adminScheduleApiPath,
  adminSchedulePath,
  scheduleDetailPath,
} from '../../src/config/routes';
const messages: typeof import('../../src/messages/ko.json') = JSON.parse(
  readFileSync(new URL('../../src/messages/ko.json', import.meta.url), 'utf8'),
);
const copy = messages.schedules;
const fictionalId = 'a9733d99-dccd-4c85-9f72-a3cd579f2eba';
test('keyless schedules fail closed for every read/write route without fabricated events or map links', async ({
  request,
}) => {
  for (const path of [
    routes.schedulesApi,
    `${routes.schedulesApi}?id=${fictionalId}`,
    routes.adminSchedulesApi,
    `${routes.adminSchedulesApi}?id=${fictionalId}`,
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(response.headers()['cache-control']).toContain('no-store');
  }
  for (const action of ['save', 'delete'] as const) {
    const response = await request.post(adminScheduleApiPath(action), {
      data: {},
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
    test(`${scale} ${width}: keyless fan/detail/admin/create/edit, retry and settled home navigation remain honest`, async ({
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
      const capture = async (name: string) => {
        await expect(page.locator('html')).toHaveAttribute(
          'data-font-scale',
          scale,
        );
        await expect(page.locator('body')).toHaveCSS(
          'font-size',
          { normal: '18px', large: '21px', xlarge: '25px' }[scale],
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: info.outputPath(`${name}-${scale}-${width}.png`),
          fullPage: true,
        });
      };
      for (const [name, path, admin] of [
        ['fan', routes.schedules, false],
        ['detail', scheduleDetailPath(fictionalId), false],
        ['admin', routes.adminSchedules, true],
        ['create', adminSchedulePath('new'), true],
        ['edit', adminSchedulePath(fictionalId), true],
      ] as const) {
        await page.goto(path);
        await expect(page).toHaveURL(path);
        const main = page.getByRole('main');
        await expect(
          main.getByRole('heading', {
            name: admin ? copy.adminTitle : copy.title,
            exact: true,
          }),
        ).toBeVisible();
        await expect(main.getByRole('alert')).toHaveText(
          copy.errors.SETUP_NOT_READY,
        );
        await expect(main.getByTestId('schedule-map-links')).toHaveCount(0);
        await expect(main.getByTestId('schedule-calendar')).toHaveCount(0);
        await expect(main.getByTestId('admin-schedule-form')).toHaveCount(0);
        await capture(`schedules-keyless-${name}-initial`);
        await main
          .getByRole('button', { name: messages.ui.retry, exact: true })
          .click();
        await expect(main.getByRole('alert')).toHaveText(
          copy.errors.SETUP_NOT_READY,
        );
      }
      await page
        .getByRole('main')
        .getByRole('link', { name: copy.backAdmin, exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`${routes.start}(?:\\?|$)`));
      await expect(
        page.getByRole('heading', {
          name: messages.auth.startTitle,
          exact: true,
        }),
      ).toBeVisible();
      await capture('schedules-keyless-back-settled');
    });
