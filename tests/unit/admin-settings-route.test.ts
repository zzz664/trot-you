// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, dynamic } from '@/app/api/admin/settings/route';
const handler = vi.hoisted(() => vi.fn());
vi.mock('@/server/admin-settings/http', () => ({ adminSettingsHttp: handler }));
it('keeps route dynamic and delegates both methods to validated boundary', async () => {
  expect(dynamic).toBe('force-dynamic');
  for (const [method, route] of [
    ['GET', GET],
    ['POST', POST],
  ] as const) {
    const request = new NextRequest('https://app.example/api/admin/settings', {
      method,
    });
    const response = new Response('fixture');
    handler.mockResolvedValueOnce(response);
    expect(await route(request)).toBe(response);
    expect(handler).toHaveBeenLastCalledWith(request);
  }
});
