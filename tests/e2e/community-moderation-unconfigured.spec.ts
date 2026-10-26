import { test, expect } from '@playwright/test';
import {
  moderationContextPath,
  moderationReportPath,
  moderationNoticesPath,
  moderationQueuePath,
  moderationAdminActionPath,
} from '../../src/config/routes';

test('keyless moderation reports setup readiness instead of invented reports, decisions or restrictions', async ({
  request,
}) => {
  for (const path of [
    moderationContextPath({
      target_type: 'post',
      target_id: 'e868be86-54d1-41c8-b805-574c34010de1',
    }),
    moderationNoticesPath(),
    moderationQueuePath(),
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(503);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
  }
  for (const path of [
    moderationReportPath(),
    moderationAdminActionPath('resolve'),
    moderationAdminActionPath('restrict'),
  ]) {
    const response = await request.post(path, { data: {} });
    expect(response.status()).toBe(503);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
  }
});
