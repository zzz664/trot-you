// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, dynamic as snapshotDynamic } from '@/app/api/points/route';
import {
  POST,
  dynamic as attendanceDynamic,
} from '@/app/api/points/attendance/route';
import { routes, pointsHistoryPath } from '@/config/routes';
const mocks = vi.hoisted(() => ({ http: vi.fn() }));
vi.mock('@/server/attendance-points/http', () => ({
  attendancePointsHttp: mocks.http,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.http.mockResolvedValue(new Response('{}'));
});
it('private routes are explicitly dynamic', () =>
  expect([snapshotDynamic, attendanceDynamic]).toEqual([
    'force-dynamic',
    'force-dynamic',
  ]));
it.each([
  [GET, 'snapshot'],
  [POST, 'attend'],
] as const)(
  'route %# delegates request and action only',
  async (call, action) => {
    const request = new NextRequest('https://app.example');
    await call(request);
    expect(mocks.http).toHaveBeenCalledExactlyOnceWith(request, action);
  },
);
it('centralizes paths and encodes the cursor exactly', () => {
  expect(routes.points).toBe('/points');
  expect(routes.pointsApi).toBe('/api/points');
  expect(routes.pointsAttendanceApi).toBe('/api/points/attendance');
  expect(pointsHistoryPath()).toBe('/api/points');
  expect(pointsHistoryPath('{"id":"a+b"}')).toBe(
    '/api/points?cursor=%7B%22id%22%3A%22a%2Bb%22%7D',
  );
});
