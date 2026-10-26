// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  GET as list,
  POST as create,
  dynamic as commentsDynamic,
} from '@/app/api/board/[slug]/[postId]/comments/route';
import {
  POST as update,
  dynamic as updateDynamic,
} from '@/app/api/board/[slug]/[postId]/comments/[commentId]/edit/route';
import {
  POST as remove,
  dynamic as deleteDynamic,
} from '@/app/api/board/[slug]/[postId]/comments/[commentId]/delete/route';
import {
  POST as like,
  dynamic as likeDynamic,
} from '@/app/api/board/[slug]/[postId]/like/route';
import {
  communityCommentsPath,
  communityCommentActionPath,
  communityLikePath,
} from '@/config/routes';
const mocks = vi.hoisted(() => ({ http: vi.fn() }));
vi.mock('@/server/community-interactions/http', () => ({
  communityInteractionsHttp: mocks.http,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.http.mockResolvedValue(new Response('{}'));
});
it('keeps all interaction routes dynamic', () =>
  expect([commentsDynamic, updateDynamic, deleteDynamic, likeDynamic]).toEqual(
    Array(4).fill('force-dynamic'),
  ));
it('routes await path params and forward no client actor override', async () => {
  const request = new NextRequest('https://app.example'),
    value = {
      slug: 'first-artist',
      postId: 'post-id',
      commentId: 'comment-id',
    },
    params = Promise.resolve(value);
  await list(request, { params });
  await create(request, { params });
  await update(request, { params });
  await remove(request, { params });
  await like(request, { params });
  expect(mocks.http.mock.calls).toEqual([
    [request, 'list', value.slug, value.postId],
    [request, 'create', value.slug, value.postId],
    [request, 'update', value.slug, value.postId, value.commentId],
    [request, 'delete', value.slug, value.postId, value.commentId],
    [request, 'like', value.slug, value.postId],
  ]);
});
it('centralizes encoded routes and JSON cursor query', () => {
  expect(communityCommentsPath('artist/name', 'post/id')).toBe(
    '/api/board/artist%2Fname/post%2Fid/comments',
  );
  expect(communityCommentsPath('artist', 'post', '{"id":"a+b"}')).toBe(
    '/api/board/artist/post/comments?cursor=%7B%22id%22%3A%22a%2Bb%22%7D',
  );
  expect(
    communityCommentActionPath('artist', 'post', 'comment/id', 'edit'),
  ).toBe('/api/board/artist/post/comments/comment%2Fid/edit');
  expect(communityLikePath('artist', 'post')).toBe(
    '/api/board/artist/post/like',
  );
});
