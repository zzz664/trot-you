import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { FONT_SCALE_COOKIE } from '../../src/config/constants';
import {
  adminArtistApiPath,
  adminArtistPath,
  routes,
} from '../../src/config/routes';

const messages: typeof import('../../src/messages/ko.json') = JSON.parse(
  readFileSync(new URL('../../src/messages/ko.json', import.meta.url), 'utf8'),
);
const copy = messages.adminArtists;
const fictionalId = 'ca280000-0000-4000-8000-000000000001';

test('keyless artist administration cannot list, create, grant, accept or fabricate preview success', async ({
  request,
}) => {
  for (const [method, path] of [
    ['GET', routes.adminArtistsApi],
    ['GET', `${routes.adminArtistsApi}?id=${fictionalId}`],
    ...(['save', 'previews', 'invite', 'cancel-invite', 'unlink'] as const).map(
      (action) => ['POST', adminArtistApiPath(action)],
    ),
    ['GET', routes.artistAccessApi],
    ['POST', routes.artistAccessApi],
  ]) {
    const response = await request.fetch(path!, {
      method: method!,
      ...(method === 'POST' ? { data: {} } : {}),
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
    test(`${scale} ${width}: all unconfigured artist admin pages show initial recoverable errors and safe links`, async ({
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
      for (const [name, path, access] of [
        ['list', routes.adminArtists, false],
        ['create', adminArtistPath('new'), false],
        ['detail', adminArtistPath(fictionalId), false],
        ['access', routes.artistAccess, true],
      ] as const) {
        await page.goto(path);
        const main = page.getByRole('main');
        await expect(
          main.getByRole('heading', {
            name: access ? copy.accessTitle : copy.title,
            exact: true,
          }),
        ).toBeVisible();
        await expect(main.getByRole('alert')).toHaveText(
          copy.errors.SETUP_NOT_READY,
        );
        await expect(
          main.locator(
            '[data-admin-artist-id],[data-admin-artist-form],[data-artist-access-id]',
          ),
        ).toHaveCount(0);
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
            `admin-artists-keyless-${name}-initial-${scale}-${width}.png`,
          ),
          fullPage: true,
        });
        await main
          .getByRole('button', { name: messages.ui.retry, exact: true })
          .click();
        await expect(main.getByRole('alert')).toHaveText(
          copy.errors.SETUP_NOT_READY,
        );
        if (!access) {
          await main
            .getByRole('link', { name: copy.first, exact: true })
            .click();
          await expect(page).toHaveURL(routes.adminArtists);
          await expect(main.getByRole('alert')).toHaveText(
            copy.errors.SETUP_NOT_READY,
          );
        }
        await main
          .getByRole('link', {
            name: access ? copy.backHome : copy.back,
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(new RegExp(`/start(?:\\?|$)`));
        await expect(
          page.getByRole('heading', {
            name: messages.auth.startTitle,
            exact: true,
          }),
        ).toBeVisible();
      }
    });
