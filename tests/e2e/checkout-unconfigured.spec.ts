import { test, expect } from '@playwright/test';
import { checkoutPath, routes } from '../../src/config/routes';
import messages from '../../src/messages/ko.json' with { type: 'json' };

// The default keyless build must not invent prices, accept terms or offer a
// provider registration/charge. No real merchant keys or provider I/O are used.
test('keyless checkout is explicitly unavailable with no fictional terms or success', async ({
  page,
  request,
}) => {
  await page.goto(checkoutPath('fictional-star'));
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    messages.checkout.errors.SETUP_NOT_READY,
  );
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: messages.checkout.completionUnavailable,
      exact: true,
    }),
  ).toBeDisabled();
  const response = await request.post(routes.checkoutSubmit, {
    data: { artistSlug: 'fictional-star', accepted: true },
  });
  expect(response.status()).toBe(503);
  expect(await response.json()).toEqual({ ok: false, code: 'SETUP_NOT_READY' });
  for (const path of [routes.checkoutSubmit, routes.checkoutCancel])
    expect((await request.get(path)).status()).toBe(405);
});

test('provider-return queries cannot mutate or redirect to caller-controlled URLs', async ({
  page,
  request,
}) => {
  for (const query of [
    '?authKey=FICTIONAL_PRIVATE_AUTH&customerKey=FICTIONAL_PRIVATE_CUSTOMER&next=https://untrusted.example',
    '?pg_token=FICTIONAL_PRIVATE_TOKEN&state=forged&next=//untrusted.example',
  ]) {
    const result = await request.get(`${routes.checkoutReturn}${query}`, {
      maxRedirects: 0,
    });
    expect(result.status()).toBe(303);
    expect(new URL(result.headers().location!).pathname).toBe(routes.checkout);
    expect(new URL(result.headers().location!).search).toBe('');
    expect(result.headers()['cache-control']).toContain('no-store');
    expect(result.headers()['referrer-policy']).toBe('no-referrer');
    expect(await result.text()).not.toContain('FICTIONAL_PRIVATE');
  }
  await page.goto(routes.checkout);
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    messages.checkout.errors.COMPLETION_UNAVAILABLE,
  );
  expect(await page.locator('body').innerText()).not.toContain(
    'FICTIONAL_PRIVATE',
  );
});
