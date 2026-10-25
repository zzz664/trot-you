import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { FONT_SCALE_COOKIE } from '../../src/config/constants';
import { observeCalendarRefresh } from './content-calendar/response-capture';
import {
  routes,
  adminContentCalendarPath,
  adminContentCalendarApiPath,
  artistContentCalendarPath,
} from '../../src/config/routes';
const messages: typeof import('../../src/messages/ko.json') = JSON.parse(
  readFileSync(new URL('../../src/messages/ko.json', import.meta.url), 'utf8'),
);
const copy = messages.contentCalendar;
const fictionalId = 'a9733d99-dccd-4c85-9f72-a3cd579f2eba';
const fictionalSlug = 'fictional-content-calendar';
const month = '2036-02';
test('keyless content calendar fails closed on every read/write route without fabricated editorial content or activity', async ({
  request,
}) => {
  for (const path of [
    `${routes.adminContentCalendarApi}?artists=1`,
    adminContentCalendarPath(month, fictionalId, 1, true),
    artistContentCalendarPath(fictionalSlug, month, true),
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
    const response = await request.post(adminContentCalendarApiPath(action), {
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
    test(`${scale} ${width}: keyless admin picker/calendar and artist calendar show honest errors and retry without private snapshots`, async ({
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
      for (const [name, path, admin] of [
        ['picker', routes.adminContentCalendar, true],
        ['admin', adminContentCalendarPath(month, fictionalId), true],
        ['artist', artistContentCalendarPath(fictionalSlug, month), false],
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
        await expect(main.getByTestId('content-calendar-list')).toHaveCount(0);
        await expect(main.getByTestId('content-calendar-form')).toHaveCount(0);
        await expect(main.getByTestId('content-calendar-activity')).toHaveCount(
          0,
        );
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
          path: info.outputPath(
            `content-calendar-keyless-${name}-${scale}-${width}.png`,
          ),
          fullPage: true,
        });
        // router.refresh keeps the same visible error while its RSC request is
        // in flight. Capture the real body before forwarding: Chromium can
        // cancel the refresh stream even while the document stays mounted.
        const retried = await observeCalendarRefresh(
          page,
          path,
          async (response) => {
            expect(response.status()).toBe(200);
            expect(response.headers()['content-type']).toContain(
              'text/x-component',
            );
            expect(response.headers()['cache-control']).toContain('no-store');
            const body = await response.body();
            expect(body.byteLength).toBeGreaterThan(0);
            expect(body.toString('utf8')).toContain('SETUP_NOT_READY');
            return body;
          },
        );
        await main
          .getByRole('button', { name: messages.ui.retry, exact: true })
          .click();
        await retried.result;
        await expect(page).toHaveURL(path);
        await expect(
          main.getByRole('heading', {
            name: admin ? copy.adminTitle : copy.title,
            exact: true,
          }),
        ).toBeVisible();
        await expect(main.getByRole('alert')).toHaveText(
          copy.errors.SETUP_NOT_READY,
        );
        await expect(
          main.getByRole('button', { name: messages.ui.retry, exact: true }),
        ).toBeEnabled();
        await expect(main.getByTestId('content-calendar-list')).toHaveCount(0);
        await expect(main.getByTestId('content-calendar-form')).toHaveCount(0);
        await expect(main.getByTestId('content-calendar-activity')).toHaveCount(
          0,
        );
      }
      await page
        .getByRole('main')
        .getByRole('link', { name: copy.backArtist, exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`${routes.start}(?:\\?|$)`));
      await expect(
        page.getByRole('heading', {
          name: messages.auth.startTitle,
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(
          `content-calendar-keyless-home-${scale}-${width}.png`,
        ),
        fullPage: true,
      });
    });
