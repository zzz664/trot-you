// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, dynamic } from '@/app/api/points/activity/route';
import { routes, activityRewardsHistoryPath } from '@/config/routes';
const mocks = vi.hoisted(() => ({ http: vi.fn() }));
vi.mock('@/server/activity-rewards/http', () => ({
  activityRewardsHttp: mocks.http,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.http.mockResolvedValue(new Response('{}'));
});
it('private activity route is explicitly dynamic', () =>
  expect(dynamic).toBe('force-dynamic'));
it('GET delegates the request without adding claims or points writes', async () => {
  const request = new NextRequest('https://app.example');
  await GET(request);
  expect(mocks.http).toHaveBeenCalledExactlyOnceWith(request);
});
it('centralizes paths and precisely encodes the private cursor', () => {
  expect(routes.activityRewards).toBe('/points/activity');
  expect(routes.activityRewardsApi).toBe('/api/points/activity');
  expect(activityRewardsHistoryPath()).toBe('/api/points/activity');
  expect(activityRewardsHistoryPath('{"id":"a+b"}')).toBe(
    '/api/points/activity?cursor=%7B%22id%22%3A%22a%2Bb%22%7D',
  );
});
