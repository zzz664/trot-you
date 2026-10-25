import 'server-only';
import { z } from 'zod';
import { artistSlugSchema } from '@/config/artists';
import {
  COMMUNITY_POSTS,
  communityListQuerySchema,
  communityDetailQuerySchema,
  communityListSchema,
  communityDetailSchema,
  communityCursorAfter,
  type CommunityResult,
  type CommunityList,
  type CommunityDetail,
  type CommunityListQuery,
  type CommunityDetailQuery,
} from '@/config/community-posts';
export type CommunityReadPort = {
  list(query: CommunityListQuery): Promise<CommunityResult<CommunityList>>;
  detail(
    query: CommunityDetailQuery,
  ): Promise<CommunityResult<CommunityDetail>>;
};
export function resolveCommunityListQuery(
  input: unknown,
): CommunityResult<CommunityListQuery> {
  const raw = z
    .strictObject({
      slug: artistSlugSchema,
      cursor: z.string().min(1).max(COMMUNITY_POSTS.cursorMax).optional(),
    })
    .safeParse(input);
  if (!raw.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const cursor: unknown =
      raw.data.cursor === undefined ? null : JSON.parse(raw.data.cursor);
    const query = communityListQuerySchema.safeParse({
      slug: raw.data.slug,
      cursor,
    });
    return query.success
      ? { ok: true, data: query.data }
      : { ok: false, code: 'INVALID_INPUT' };
  } catch {
    return { ok: false, code: 'INVALID_INPUT' };
  }
}
export async function listCommunityPosts(
  port: CommunityReadPort,
  input: unknown,
  actorId: string,
): Promise<CommunityResult<CommunityList>> {
  const query = communityListQuerySchema.safeParse(input);
  if (!query.success || !z.uuid().safeParse(actorId).success)
    return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.list(query.data);
    if (!result.ok) return result;
    const page = communityListSchema.safeParse(result.data);
    return page.success &&
      page.data.actor_id === actorId &&
      page.data.artist.slug === query.data.slug &&
      (query.data.cursor === null ||
        page.data.posts.every((post) =>
          communityCursorAfter(post, query.data.cursor!),
        ))
      ? { ok: true, data: page.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function getCommunityPost(
  port: CommunityReadPort,
  input: unknown,
  actorId: string,
): Promise<CommunityResult<CommunityDetail>> {
  const query = communityDetailQuerySchema.safeParse(input);
  if (!query.success || !z.uuid().safeParse(actorId).success)
    return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.detail(query.data);
    if (!result.ok) return result;
    const page = communityDetailSchema.safeParse(result.data);
    return page.success &&
      page.data.actor_id === actorId &&
      page.data.artist.slug === query.data.slug &&
      page.data.post.id === query.data.post_id
      ? { ok: true, data: page.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
