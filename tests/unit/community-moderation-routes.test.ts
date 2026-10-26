// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  GET as context,
  dynamic as contextDynamic,
} from '@/app/api/community/moderation/route';
import {
  POST as report,
  dynamic as reportDynamic,
} from '@/app/api/community/moderation/report/route';
import {
  GET as notices,
  dynamic as noticesDynamic,
} from '@/app/api/community/moderation/notices/route';
import {
  GET as queue,
  dynamic as queueDynamic,
} from '@/app/api/admin/moderation/route';
import {
  POST as resolve,
  dynamic as resolveDynamic,
} from '@/app/api/admin/moderation/resolve/route';
import {
  POST as restrict,
  dynamic as restrictDynamic,
} from '@/app/api/admin/moderation/restrict/route';
import {
  moderationContextPath,
  moderationReportPath,
  moderationQueuePath,
  moderationNoticesPath,
  moderationAdminActionPath,
  routes,
} from '@/config/routes';
const mocks = vi.hoisted(() => ({ http: vi.fn() }));
vi.mock('@/server/community-moderation/http', () => ({
  communityModerationHttp: mocks.http,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.http.mockResolvedValue(new Response('{}'));
});
it('all private routes are explicitly dynamic', () =>
  expect([
    contextDynamic,
    reportDynamic,
    noticesDynamic,
    queueDynamic,
    resolveDynamic,
    restrictDynamic,
  ]).toEqual(Array(6).fill('force-dynamic')));
it.each([
  [context, 'context'],
  [report, 'report'],
  [notices, 'notices'],
  [queue, 'queue'],
  [resolve, 'resolve'],
  [restrict, 'restrict'],
] as const)(
  'route %# delegates only action and request',
  async (call, action) => {
    const request = new NextRequest('https://app.example');
    await call(request);
    expect(mocks.http).toHaveBeenCalledExactlyOnceWith(request, action);
  },
);
it('centralizes private UI/API routes and safely encoded cursor', () => {
  expect(routes.communityReports).toBe('/me/reports');
  expect(routes.adminModeration).toBe('/admin/moderation');
  expect(
    moderationContextPath({ target_type: 'post', target_id: 'id+key' }),
  ).toBe('/api/community/moderation?target_type=post&target_id=id%2Bkey');
  expect(moderationReportPath()).toBe('/api/community/moderation/report');
  expect(moderationQueuePath()).toBe('/api/admin/moderation');
  expect(moderationNoticesPath()).toBe('/api/community/moderation/notices');
  expect(moderationQueuePath('{"id":"a+b"}')).toBe(
    '/api/admin/moderation?cursor=%7B%22id%22%3A%22a%2Bb%22%7D',
  );
  expect(moderationNoticesPath('{"id":"a+b"}')).toBe(
    '/api/community/moderation/notices?cursor=%7B%22id%22%3A%22a%2Bb%22%7D',
  );
  expect(moderationAdminActionPath('resolve')).toBe(
    '/api/admin/moderation/resolve',
  );
  expect(moderationAdminActionPath('restrict')).toBe(
    '/api/admin/moderation/restrict',
  );
});
