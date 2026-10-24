import { test, expect } from '@playwright/test';
import { routes } from '../../src/config/routes';
import messages from '../../src/messages/ko.json' with { type: 'json' };

test('keys are optional: login is disabled without pretending to authenticate', async ({
  page,
}) => {
  await page.goto(routes.start);
  const login = page.getByRole('button', { name: messages.auth.login });
  await expect(login).toBeDisabled();
  await expect(login).toHaveAccessibleDescription(messages.auth.unavailable);
  await page.reload();
  await expect(login).toBeDisabled();
  await expect(page.getByText(messages.auth.sessionTitle)).toHaveCount(0);
});

test('interrupted and malformed callbacks discard provider text and redirect targets', async ({
  page,
  request,
}) => {
  const queries = [
    '',
    '?error=access_denied&error_description=PRIVATE_PROVIDER_MESSAGE',
    '?code=bad&code=duplicate&next=https://evil.example',
    '?code=%0d%0aLocation:evil&next=//evil.example',
    '?code=invalid&next=%2F%5Cevil.example',
    `?code=${'x'.repeat(2049)}&next=/admin`,
  ];
  for (const query of queries) {
    const response = await request.get(`${routes.authCallback}${query}`, {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(response.headers().location).toBe(
      `${routes.start}?reason=callback_failed`,
    );
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['referrer-policy']).toBe('no-referrer');
  }
  await page.goto(
    `${routes.authCallback}?error_description=PRIVATE_PROVIDER_MESSAGE`,
  );
  await expect(page).toHaveURL(/\/start\?reason=callback_failed$/);
  await expect(page.getByRole('status')).toHaveText(
    messages.auth.callback_failed,
  );
  expect(
    (await page.locator('body').innerText()).includes(
      'PRIVATE_PROVIDER_MESSAGE',
    ),
  ).toBe(false);
});

test('all protected session shells fail closed without configuration', async ({
  page,
  request,
}) => {
  for (const path of [
    routes.home,
    routes.artist,
    routes.admin,
    routes.onboarding,
    routes.restricted,
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/start\?/);
    await expect(
      page.getByRole('button', { name: messages.auth.login }),
    ).toBeDisabled();
  }
  const login = await request.post(
    `${routes.authLogin}?next=https://evil.example`,
    { maxRedirects: 0 },
  );
  expect(login.status()).toBe(303);
  expect(login.headers().location).toBe(`${routes.start}?reason=login_failed`);
  const logout = await request.post(routes.authLogout, { maxRedirects: 0 });
  expect(logout.status()).toBe(503);
  const logoutGet = await request.get(routes.authLogout, { maxRedirects: 0 });
  expect(logoutGet.status()).toBe(405);
});
