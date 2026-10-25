// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import BoardPage from '@/app/board/[slug]/page';
import CreatePage from '@/app/board/[slug]/new/page';
import DetailPage from '@/app/board/[slug]/[postId]/page';
import { CommunityBoard } from '@/components/community-posts/CommunityBoard';
import { CommunityComposer } from '@/components/community-posts/CommunityComposer';
import { CommunityPostDetail } from '@/components/community-posts/CommunityPostDetail';
import { CommunityErrorScreen } from '@/components/community-posts/CommunityErrorScreen';
import {
  communityBoardPath,
  communityPostPath,
  communityCreatePath,
  communityPostActionPath,
  communityMediaPath,
  routes,
} from '@/config/routes';
import {
  boardActorId,
  boardArtist,
  boardPostId,
} from './community-posts-fixtures';
const mocks = vi.hoisted(() => ({ identity: vi.fn() }));
vi.mock('@/server/community-posts/page', () => ({
  getCommunityPostsPage: mocks.identity,
}));
vi.mock('@/components/community-posts/CommunityBoard', () => ({
  CommunityBoard: () => null,
}));
vi.mock('@/components/community-posts/CommunityComposer', () => ({
  CommunityComposer: () => null,
}));
vi.mock('@/components/community-posts/CommunityPostDetail', () => ({
  CommunityPostDetail: () => null,
}));
vi.mock('@/components/community-posts/CommunityErrorScreen', () => ({
  CommunityErrorScreen: () => null,
}));
const params = Promise.resolve({ slug: boardArtist.slug, postId: boardPostId });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue({ ok: true, data: { key: boardActorId } });
});
it('mounts list with only route and actor data, never post snapshots', async () => {
  const result = await BoardPage({ params, searchParams: Promise.resolve({}) });
  expect(result.type).toBe(CommunityBoard);
  expect(result.props).toEqual({
    query: { slug: boardArtist.slug, cursor: null },
    actorKey: boardActorId,
    path: communityBoardPath(boardArtist.slug),
  });
  expect(result.key).toContain(boardActorId);
});
it('mounts create and detail with only actor and resource IDs', async () => {
  const create = await CreatePage({
    params,
    searchParams: Promise.resolve({}),
  });
  expect(create.type).toBe(CommunityComposer);
  expect(create.props).toEqual({
    slug: boardArtist.slug,
    actorKey: boardActorId,
    path: communityCreatePath(boardArtist.slug),
  });
  const detail = await DetailPage({
    params,
    searchParams: Promise.resolve({}),
  });
  expect(detail.type).toBe(CommunityPostDetail);
  expect(detail.props).toEqual({
    slug: boardArtist.slug,
    postId: boardPostId,
    actorKey: boardActorId,
    path: communityPostPath(boardArtist.slug, boardPostId),
  });
});
it('preserves valid noncanonical cursor spelling in the mounted browser path', async () => {
  const cursor = `{ "id": "${boardPostId}", "is_pinned": false, "created_at": "2026-10-25T10:00:00Z" }`;
  const result = await BoardPage({
    params,
    searchParams: Promise.resolve({ cursor }),
  });
  expect(result.type).toBe(CommunityBoard);
  expect(result.props.path).toBe(communityBoardPath(boardArtist.slug, cursor));
  expect(result.props.query.cursor.id).toBe(boardPostId);
});
it.each([
  { slug: 'different' },
  { cursor: '' },
  { cursor: 'true' },
  { cursor: '{}' },
  { cursor: ['x', 'y'] },
  { actor_id: boardActorId },
  { page: '1' },
])('rejects malformed or injected list query %#', async (query) => {
  const result = await BoardPage({
    params,
    searchParams: Promise.resolve(query),
  });
  expect(result.type).toBe(CommunityErrorScreen);
  expect(result.props.code).toBe('INVALID_INPUT');
});
it.each(['', '../name', 'with/slash', 'Bad'])(
  'rejects malformed path slug %j',
  async (slug) => {
    for (const Page of [BoardPage, CreatePage, DetailPage]) {
      const result = await Page({
        params: Promise.resolve({ slug, postId: boardPostId }),
        searchParams: Promise.resolve({}),
      });
      expect(result.type).toBe(CommunityErrorScreen);
      expect(result.props.code).toBe('INVALID_INPUT');
    }
  },
);
it('rejects query keys on create and detail plus malformed detail id', async () => {
  for (const Page of [CreatePage, DetailPage]) {
    const result = await Page({
      params,
      searchParams: Promise.resolve({ cursor: 'ignored' }),
    });
    expect(result.props.code).toBe('INVALID_INPUT');
  }
  const result = await DetailPage({
    params: Promise.resolve({ slug: boardArtist.slug, postId: 'bad' }),
    searchParams: Promise.resolve({}),
  });
  expect(result.props.code).toBe('INVALID_INPUT');
});
it.each(['SETUP_NOT_READY', 'UNAVAILABLE', 'FORBIDDEN'])(
  'identity %s never mounts private client',
  async (code) => {
    mocks.identity.mockResolvedValue({ ok: false, code });
    for (const Page of [BoardPage, CreatePage, DetailPage]) {
      const result = await Page({ params, searchParams: Promise.resolve({}) });
      expect(result.type).toBe(CommunityErrorScreen);
      expect(result.props).toEqual({ code });
    }
  },
);
it('centralizes safe route encoding for all board and media endpoints', () => {
  expect(communityBoardPath('a/b')).toBe('/board/a%2Fb');
  expect(communityPostPath('a', 'b/c', true)).toBe('/api/board/a/b%2Fc');
  expect(communityPostActionPath('a', 'b', 'notice')).toBe(
    '/api/board/a/b/notice',
  );
  expect(communityCreatePath('a')).toBe('/board/a/new');
  expect(communityMediaPath('begin')).toBe(routes.communityImageBegin);
});
