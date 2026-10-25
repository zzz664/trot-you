// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  GET as adminGet,
  dynamic as adminDynamic,
} from '@/app/api/admin/content-calendar/route';
import {
  POST as savePost,
  dynamic as saveDynamic,
} from '@/app/api/admin/content-calendar/save/route';
import {
  POST as deletePost,
  dynamic as deleteDynamic,
} from '@/app/api/admin/content-calendar/delete/route';
import {
  GET as artistGet,
  dynamic as artistDynamic,
} from '@/app/api/artist/[slug]/calendar/route';
const mocks = vi.hoisted(() => ({ http: vi.fn() }));
vi.mock('@/server/content-calendar/http', () => ({
  contentCalendarHttp: mocks.http,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.http.mockResolvedValue(new Response('{}'));
});
it('all private calendar handlers are explicitly dynamic', () =>
  expect([adminDynamic, saveDynamic, deleteDynamic, artistDynamic]).toEqual(
    Array(4).fill('force-dynamic'),
  ));
it('route files forward requests to the centralized authority/services boundary', async () => {
  const request = new NextRequest('https://app.example');
  await adminGet(request);
  await savePost(request);
  await deletePost(request);
  await artistGet(request, { params: Promise.resolve({ slug: 'safe-slug' }) });
  expect(mocks.http.mock.calls).toEqual([
    [request, 'admin'],
    [request, 'save'],
    [request, 'delete'],
    [request, 'artist', 'safe-slug'],
  ]);
});
