// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  GET as list,
  POST as create,
  dynamic as listDynamic,
} from '@/app/api/board/[slug]/route';
import {
  GET as detail,
  dynamic as detailDynamic,
} from '@/app/api/board/[slug]/[postId]/route';
import {
  POST as remove,
  dynamic as deleteDynamic,
} from '@/app/api/board/[slug]/[postId]/delete/route';
import {
  POST as notice,
  dynamic as noticeDynamic,
} from '@/app/api/board/[slug]/[postId]/notice/route';
const mocks = vi.hoisted(() => ({ http: vi.fn() }));
vi.mock('@/server/community-posts/http', () => ({
  communityPostsHttp: mocks.http,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.http.mockResolvedValue(new Response('{}'));
});
it('keeps all post boundaries dynamic', () =>
  expect([listDynamic, detailDynamic, deleteDynamic, noticeDynamic]).toEqual(
    Array(4).fill('force-dynamic'),
  ));
it('routes forward only path identities to centralized service authority boundary', async () => {
  const request = new NextRequest('https://app.example');
  const params = Promise.resolve({
    slug: 'first-artist',
    postId: 'b4000000-0000-4000-8000-000000000003',
  });
  await list(request, { params });
  await create(request, { params });
  await detail(request, { params });
  await remove(request, { params });
  await notice(request, { params });
  expect(mocks.http.mock.calls).toEqual([
    [request, 'list', 'first-artist'],
    [request, 'create', 'first-artist'],
    [request, 'detail', 'first-artist', (await params).postId],
    [request, 'delete', 'first-artist', (await params).postId],
    [request, 'notice', 'first-artist', (await params).postId],
  ]);
});
