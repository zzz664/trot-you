import { test, expect } from '@playwright/test';
import { routes } from '../../src/config/routes';

test('keyless points fails closed without invented attendance or balances', async ({
  request,
}) => {
  for (const response of [
    await request.get(routes.pointsApi),
    await request.post(routes.pointsAttendanceApi, { data: {} }),
  ]) {
    expect(response.status()).toBe(503);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
  }
});
