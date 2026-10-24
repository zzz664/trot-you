import { test, expect } from '@playwright/test';
import { fanRepliesPath } from '../../src/config/routes';

test('keyless reply APIs fail closed without writing or fabricating own history', async ({
  request,
}) => {
  for (const response of [
    await request.get(fanRepliesPath('fictional-reply')),
    await request.post(fanRepliesPath('fictional-reply'), {
      data: {
        operationId: 'c4200000-0000-4000-8000-000000000001',
        body: '허구 답장',
        messageId: null,
      },
    }),
  ]) {
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(response.headers()['cache-control']).toContain('no-store');
  }
  expect(
    (
      await request.put(fanRepliesPath('fictional-reply'), { data: {} })
    ).status(),
  ).toBe(405);
});
