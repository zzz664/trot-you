import { test, expect } from '@playwright/test';
import { routes } from '../../src/config/routes';
test('keyless analytics dashboard fails closed without fabricated counts or business metrics', async ({
  request,
}) => {
  const response = await request.get(routes.analyticsFunnelApi);
  expect(response.status()).toBe(503);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(await response.json()).toEqual({ ok: false, code: 'SETUP_NOT_READY' });
});
