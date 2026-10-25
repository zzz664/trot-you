import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import {
  artistReplyActivityApiPath,
  artistReplyActivityPath,
  routes,
} from '../../src/config/routes';

const messages: typeof import('../../src/messages/ko.json') = JSON.parse(
  readFileSync(new URL('../../src/messages/ko.json', import.meta.url), 'utf8'),
);
const copy = messages.artistReplyActivity;

test('keyless activity read routes fail closed without invented reply or activity data', async ({
  request,
}) => {
  for (const action of [undefined, 'messages'] as const) {
    const path = artistReplyActivityApiPath('fictional-activity', action);
    const response = await request.post(path, {
      data: action ? {} : { messageId: null },
    });
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(response.headers()['cache-control']).toContain('no-store');
    expect((await request.get(path)).status()).toBe(405);
  }
});

test('keyless activity pages show a real Retry and Back without fictional success', async ({
  page,
}) => {
  for (const path of [
    routes.artistReplyActivityMenu,
    artistReplyActivityPath('fictional-activity'),
  ]) {
    await page.goto(path);
    await expect(
      page
        .getByRole('main')
        .getByRole('heading', { name: copy.errorTitle, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      copy.errors.SETUP_NOT_READY,
    );
    await expect(page.locator('[data-activity-reply-id]')).toHaveCount(0);
    await expect(page.locator('[data-activity-metric]')).toHaveCount(0);
    await page
      .getByRole('button', { name: messages.ui.retry, exact: true })
      .click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      copy.errors.SETUP_NOT_READY,
    );
    await page.getByRole('link', { name: copy.back, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${routes.artist}$`));
  }
});
