import { test, expect } from '@playwright/test';
import { legalDocumentPath } from '../../src/config/routes';
import messages from '../../src/messages/ko.json' with { type: 'json' };

test('keyless legal readers show unavailable configuration without invented legal text or consent controls', async ({
  page,
}) => {
  for (const path of [
    legalDocumentPath('terms'),
    legalDocumentPath('privacy'),
    legalDocumentPath('terms', 'a1420000-0000-4000-8000-000000000001'),
  ]) {
    await page.goto(path);
    await expect(
      page.getByText(messages.legalDocuments.unconfigured, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: messages.ui.retry, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: messages.ui.back, exact: true }),
    ).toBeVisible();
    await expect(page.getByText('CI 허구 문서', { exact: false })).toHaveCount(
      0,
    );
  }
});
