import { test, expect } from '@playwright/test';
import { routes, settlementReportExportPath } from '../../src/config/routes';

test('keyless settlement readers and export fail closed without fabricated financial results', async ({
  request,
}) => {
  for (const path of [
    routes.adminSettlementsApi,
    routes.artistSettlementsApi,
    settlementReportExportPath(
      'd4010000-0000-4000-8000-000000000001',
      'd4010000-0000-4000-8000-000000000002',
    ),
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(503);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
  }
});
