// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as route from '@/app/api/admin/subscriptions/route';
const handler = vi.hoisted(() => vi.fn());
vi.mock('@/server/admin-subscriptions/http', () => ({
  adminSubscriptionHttp: handler,
}));
it('exposes only dynamic read and delegates the request unchanged', async () => {
  const request = new NextRequest(
    'https://app.example/api/admin/subscriptions',
  );
  const response = new Response();
  handler.mockResolvedValue(response);
  expect(route.dynamic).toBe('force-dynamic');
  expect(await route.GET(request)).toBe(response);
  expect(handler).toHaveBeenCalledExactlyOnceWith(request);
  expect(Object.keys(route).sort()).toEqual(['GET', 'dynamic']);
});
