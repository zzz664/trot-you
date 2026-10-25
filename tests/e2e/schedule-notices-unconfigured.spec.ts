import { test, expect } from '@playwright/test';
import { routes } from '../../src/config/routes';

const fictionalId = 'cf973da2-3689-4500-b2fb-c1e83f211983';
test('keyless schedule notices refuse actor reads/writes and disabled worker without made-up preference or delivery', async ({
  request,
}) => {
  for (const path of [
    routes.scheduleNoticeStatus,
    `${routes.scheduleNoticeStatus}?id=${fictionalId}`,
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(response.headers()['cache-control']).toContain('no-store');
  }
  for (const path of [
    routes.scheduleNoticePreference,
    routes.scheduleNoticeEvent,
    routes.notifySchedulesCron,
  ]) {
    const response = await request.post(path, { data: {} });
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(response.headers()['cache-control']).toContain('no-store');
  }
});
