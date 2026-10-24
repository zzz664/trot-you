import { test, expect } from '@playwright/test';
import { artistComposeApiPath } from '../../src/config/routes';

test('keyless artist authoring cannot fabricate drafts, previews, uploads or removals', async ({
  request,
}) => {
  for (const action of [undefined, 'save', 'preview', 'remove'] as const) {
    const path = artistComposeApiPath('fictional-compose', action);
    const response = await request.post(path, { data: {} });
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(response.headers()['cache-control']).toContain('no-store');
    expect((await request.get(path)).status()).toBe(405);
  }
});
