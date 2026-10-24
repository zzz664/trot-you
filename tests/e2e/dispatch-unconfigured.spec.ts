import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import {
  artistDispatchApiPath,
  artistDispatchPath,
  routes,
} from '../../src/config/routes';

test('keyless dispatch routes never create a publication, schedule, cancellation or worker success', async ({
  request,
}) => {
  for (const action of [undefined, 'submit', 'cancel'] as const) {
    const path = artistDispatchApiPath('fictional-dispatch', action);
    const response = await request.post(path, { data: {} });
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(response.headers()['cache-control']).toContain('no-store');
    expect((await request.get(path)).status()).toBe(405);
  }
  for (const method of ['get', 'post'] as const) {
    const response = await request[method](routes.dispatchMessages);
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(response.headers()['cache-control']).toContain('no-store');
  }
});

test('keyless artist history pages retain retry and Back without fictional history', async ({
  page,
}) => {
  const messages: typeof import('../../src/messages/ko.json') = JSON.parse(
    readFileSync(
      new URL('../../src/messages/ko.json', import.meta.url),
      'utf8',
    ),
  );
  const copy = messages.artistDispatch;
  for (const path of [
    routes.artistDispatchHistory,
    artistDispatchPath('fictional-dispatch'),
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
    await expect(
      page.getByRole('button', { name: messages.ui.retry, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: copy.back, exact: true }),
    ).toHaveAttribute('href', routes.artist);
    await expect(page.locator('[data-dispatch-id]')).toHaveCount(0);
  }
});
