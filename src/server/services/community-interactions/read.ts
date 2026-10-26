import 'server-only';
import { z } from 'zod';
import { artistSlugSchema } from '@/config/artists';
import {
  COMMUNITY_POSTS,
  type CommunityResult,
} from '@/config/community-posts';
import {
  communityInteractionsQuerySchema,
  communityInteractionsSchema,
  communityCommentAfter,
  type CommunityInteractionsQuery,
  type CommunityInteractions,
} from '@/config/community-interactions';
export type CommunityInteractionsReadPort = {
  list(
    query: CommunityInteractionsQuery,
  ): Promise<CommunityResult<CommunityInteractions>>;
};
export function resolveCommunityInteractionsQuery(
  input: unknown,
): CommunityResult<CommunityInteractionsQuery> {
  const raw = z
    .strictObject({
      slug: artistSlugSchema,
      post_id: z.uuid(),
      cursor: z.string().min(1).max(COMMUNITY_POSTS.cursorMax).optional(),
    })
    .safeParse(input);
  if (!raw.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const cursor: unknown =
      raw.data.cursor === undefined ? null : JSON.parse(raw.data.cursor);
    const query = communityInteractionsQuerySchema.safeParse({
      ...raw.data,
      cursor,
    });
    return query.success
      ? { ok: true, data: query.data }
      : { ok: false, code: 'INVALID_INPUT' };
  } catch {
    return { ok: false, code: 'INVALID_INPUT' };
  }
}
export async function listCommunityInteractions(
  port: CommunityInteractionsReadPort,
  input: unknown,
  actorId: string,
): Promise<CommunityResult<CommunityInteractions>> {
  const query = communityInteractionsQuerySchema.safeParse(input);
  if (!query.success || !z.uuid().safeParse(actorId).success)
    return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.list(query.data);
    if (!result.ok) return result;
    const page = communityInteractionsSchema.safeParse(result.data);
    return page.success &&
      page.data.actor_id === actorId &&
      page.data.post_id === query.data.post_id &&
      (query.data.cursor === null ||
        page.data.comments.every((comment) =>
          communityCommentAfter(comment, query.data.cursor!),
        ))
      ? { ok: true, data: page.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
