import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import {
  artistPreviewPath,
  chatMessagesPath,
  chatReadPath,
} from '../../src/config/routes';
const messages: typeof import('../../src/messages/ko.json') = JSON.parse(
  readFileSync(new URL('../../src/messages/ko.json', import.meta.url), 'utf8'),
);
const slug = 'fictional-chat';
const messageId = 'c4100000-0000-4000-8000-000000000001';

test('keyless chat page and API never fabricate paid content or read evidence', async ({
  page,
  request,
}) => {
  await page.goto(artistPreviewPath(slug));
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    messages.artists.errors.SETUP_NOT_READY,
  );
  await expect(page.locator('[data-message-id]')).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: messages.chat.markRead, exact: true }),
  ).toHaveCount(0);
  for (const response of [
    await request.get(chatMessagesPath(slug)),
    await request.post(chatReadPath(slug, messageId), { data: {} }),
  ]) {
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(response.headers()['cache-control']).toContain('no-store');
  }
  expect((await request.get(chatReadPath(slug, messageId))).status()).toBe(405);
  expect(
    (await request.post(chatMessagesPath(slug), { data: {} })).status(),
  ).toBe(405);
});
