// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, dynamic } from '@/app/api/admin/analytics/route';
import { analyticsFunnelPath, routes } from '@/config/routes';
const mock = vi.hoisted(() => ({ http: vi.fn() }));
vi.mock('@/server/analytics-funnel/http', () => ({
  analyticsFunnelHttp: mock.http,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mock.http.mockResolvedValue(new Response('{}'));
});
it('route is explicitly dynamic', () => expect(dynamic).toBe('force-dynamic'));
it('GET delegates without mutation or aggregate logic', async () => {
  const request = new NextRequest('https://app.example');
  await GET(request);
  expect(mock.http).toHaveBeenCalledExactlyOnceWith(request);
});
it('centralizes UI/API routes and exact encoded dates', () => {
  expect(routes.analyticsFunnel).toBe('/admin/analytics');
  expect(routes.analyticsFunnelApi).toBe('/api/admin/analytics');
  expect(analyticsFunnelPath({ from: 'a+b', to: 'c d' })).toBe(
    '/admin/analytics?from=a%2Bb&to=c+d',
  );
  expect(
    analyticsFunnelPath({ from: '2026-10-01', to: '2026-10-25' }, true),
  ).toBe('/api/admin/analytics?from=2026-10-01&to=2026-10-25');
});
