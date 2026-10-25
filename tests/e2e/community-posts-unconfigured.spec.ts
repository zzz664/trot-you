import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { FONT_SCALE_COOKIE } from '../../src/config/constants';
import { observeCommunityRefresh } from './community-posts/response-capture';
import {
  communityBoardPath,
  communityCreatePath,
  communityPostPath,
  communityPostActionPath,
  communityMediaPath,
  routes,
} from '../../src/config/routes';
const messages: typeof import('../../src/messages/ko.json') = JSON.parse(
  readFileSync(new URL('../../src/messages/ko.json', import.meta.url), 'utf8'),
);
const copy = messages.communityPosts;
const fictionalId = 'e868be86-54d1-41c8-b805-574c34010de1';
const fictionalSlug = 'fictional-community-board';

test('keyless community reads, posts, notices, deletions and image grants fail closed without invented posts or uploads', async ({
  request,
}) => {
  for (const path of [
    communityBoardPath(fictionalSlug, null, true),
    communityPostPath(fictionalSlug, fictionalId, true),
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(response.headers()['cache-control']).toContain('no-store');
  }
  for (const path of [
    communityBoardPath(fictionalSlug, null, true),
    communityPostActionPath(fictionalSlug, fictionalId, 'delete'),
    communityPostActionPath(fictionalSlug, fictionalId, 'notice'),
    ...(['begin', 'complete', 'revoke', 'read'] as const).map(
      communityMediaPath,
    ),
  ]) {
    const response = await request.post(path, { data: {} });
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
    test(`${scale} ${width}: keyless board list, create and detail show an honest setup error and settled retry`, async ({
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
      for (const [name, path] of [
        ['list', communityBoardPath(fictionalSlug)],
        ['create', communityCreatePath(fictionalSlug)],
        ['detail', communityPostPath(fictionalSlug, fictionalId)],
      ] as const) {
        await page.goto(path);
        await expect(page).toHaveURL(path);
        const main = page.getByRole('main');
        await expect(
          main.getByRole('heading', { name: copy.title, exact: true }),
        ).toBeVisible();
        await expect(main.getByRole('alert')).toHaveText(
          copy.errors.SETUP_NOT_READY,
        );
        for (const testId of [
          'community-post-list',
          'community-post-detail',
          'community-post-form',
        ])
          await expect(main.getByTestId(testId)).toHaveCount(0);
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
            `community-keyless-${name}-${scale}-${width}.png`,
          ),
          fullPage: true,
        });
        const retried = await observeCommunityRefresh(
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
          main.getByRole('heading', { name: copy.title, exact: true }),
        ).toBeVisible();
        await expect(main.getByRole('alert')).toHaveText(
          copy.errors.SETUP_NOT_READY,
        );
        await expect(
          main.getByRole('button', { name: messages.ui.retry, exact: true }),
        ).toBeEnabled();
        for (const testId of [
          'community-post-list',
          'community-post-detail',
          'community-post-form',
        ])
          await expect(main.getByTestId(testId)).toHaveCount(0);
      }
      await page
        .getByRole('main')
        .getByRole('link', { name: copy.backArtists, exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`${routes.artists}(?:\\?|$)`));
      await expect(
        page.getByRole('main').getByRole('heading', {
          name: messages.artists.errorTitle,
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByRole('main').getByRole('alert')).toHaveText(
        messages.artists.errors.SETUP_NOT_READY,
      );
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
        path: info.outputPath(`community-keyless-return-${scale}-${width}.png`),
        fullPage: true,
      });
    });
