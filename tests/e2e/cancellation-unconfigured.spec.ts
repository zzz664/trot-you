import { test, expect } from '@playwright/test';
import {
  routes,
  subscriptionPath,
  adminRefundPath,
} from '../../src/config/routes';
import messages from '../../src/messages/ko.json' with { type: 'json' };

const fixtureId = 'da230000-0000-4000-8000-000000000001';

test('keyless subscription and refund pages remain unavailable without fictional policy or operation controls', async ({
  page,
  request,
}) => {
  for (const path of [
    routes.subscriptions,
    subscriptionPath(fixtureId),
    routes.adminRefunds,
    adminRefundPath(fixtureId),
  ]) {
    await page.goto(path);
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      messages.subscriptions.errors.SETUP_NOT_READY,
    );
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(
      page.getByRole('button', {
        name: messages.subscriptions.cancel,
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', {
        name: messages.subscriptions.request,
        exact: true,
      }),
    ).toHaveCount(0);
    expect(await page.content()).not.toMatch(
      /ci_billing_|ci_sid_|merchant_account|provider_payment_id|lease_token/,
    );
  }
  for (const path of [
    routes.subscriptionCancel,
    routes.refundRequest,
    routes.refundAuthorize,
    routes.refundExecute,
    routes.refundReconcile,
    routes.refundReject,
  ]) {
    const response = await request.post(path, {
      data: { requestId: fixtureId },
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
