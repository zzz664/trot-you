import { test, expect } from '@playwright/test';
import { routes } from '../../src/config/routes';
test('keyless activity rewards fails closed without invented amounts, missions or grades', async ({
  request,
}) => {
  const response = await request.get(routes.activityRewardsApi);
  expect(response.status()).toBe(503);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(await response.json()).toEqual({ ok: false, code: 'SETUP_NOT_READY' });
});
