import 'server-only';
import { z } from 'zod';
import { NextResponse, type NextRequest } from 'next/server';
import {
  COMMUNITY_POSTS,
  COMMUNITY_ERROR_STATUS,
  type CommunityResult,
} from '@/config/community-posts';
import {
  communityCommentCreateSchema,
  communityCommentUpdateSchema,
  communityCommentDeleteSchema,
  communityLikeSchema,
} from '@/config/community-interactions';
import { artistSlugSchema } from '@/config/artists';
import { createAuthContext } from '@/server/auth/context';
import { readSession } from '@/server/services/auth/session';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { createCommunityInteractionsPort } from '@/server/db/community-interactions';
import {
  listCommunityInteractions,
  resolveCommunityInteractionsQuery,
} from '@/server/services/community-interactions/read';
import {
  createCommunityComment,
  updateCommunityComment,
  deleteCommunityComment,
  setCommunityLike,
} from '@/server/services/community-interactions/manage';
import { communityPostsBody } from '@/server/community-posts/security';
export async function communityInteractionsHttp(
  request: NextRequest,
  action: 'list' | 'create' | 'update' | 'delete' | 'like',
  slug: unknown,
  postId: unknown,
  commentId?: unknown,
) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: CommunityResult<unknown>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok
          ? COMMUNITY_POSTS.httpOk
          : COMMUNITY_ERROR_STATUS[result.code],
        headers: { 'X-Content-Type-Options': 'nosniff' },
      }),
    );
  try {
    if (!context.configuration || !context.client || !context.port)
      return respond({ ok: false, code: 'SETUP_NOT_READY' });
    const read = action === 'list',
      params = request.nextUrl.searchParams;
    if (
      (read ? request.method !== 'GET' : request.method !== 'POST') ||
      (read
        ? [...params.keys()].some(
            (key) => key !== 'cursor' || params.getAll(key).length !== 1,
          )
        : params.size > 0) ||
      !artistSlugSchema.safeParse(slug).success ||
      !z.uuid().safeParse(postId).success ||
      ((action === 'update' || action === 'delete') &&
        !z.uuid().safeParse(commentId).success)
    )
      return respond({ ok: false, code: 'INVALID_INPUT' });
    if (
      !read &&
      !isSameOriginPost(
        request.headers.get('origin'),
        context.configuration.appOrigin,
      )
    )
      return respond({ ok: false, code: 'FORBIDDEN' });
    const state = await readSession(context.port);
    if (state.status !== 'authenticated')
      return respond({
        ok: false,
        code:
          state.status === 'unavailable' ? 'UNAVAILABLE' : 'UNAUTHENTICATED',
      });
    if (
      isRestricted(state.profile) ||
      (state.profile.role === 'fan' &&
        !state.profile.onboarding_completed_at) ||
      request.headers.get(COMMUNITY_POSTS.actorHeader) !== state.profile.id
    )
      return respond({ ok: false, code: 'FORBIDDEN' });
    const port = createCommunityInteractionsPort(context.client);
    if (read) {
      const query = resolveCommunityInteractionsQuery({
        slug,
        post_id: postId,
        ...Object.fromEntries(params),
      });
      return respond(
        query.ok
          ? await listCommunityInteractions(port, query.data, state.profile.id)
          : query,
      );
    }
    const body = await communityPostsBody(request);
    if (action === 'create') {
      const parsed = communityCommentCreateSchema.safeParse(body);
      if (!parsed.success || parsed.data.post_id !== postId)
        return respond({ ok: false, code: 'INVALID_INPUT' });
      return respond(await createCommunityComment(port, slug, parsed.data));
    }
    if (action === 'update') {
      const parsed = communityCommentUpdateSchema.safeParse(body);
      if (
        !parsed.success ||
        parsed.data.post_id !== postId ||
        parsed.data.comment_id !== commentId
      )
        return respond({ ok: false, code: 'INVALID_INPUT' });
      return respond(await updateCommunityComment(port, slug, parsed.data));
    }
    if (action === 'delete') {
      const parsed = communityCommentDeleteSchema.safeParse(body);
      if (
        !parsed.success ||
        parsed.data.post_id !== postId ||
        parsed.data.comment_id !== commentId
      )
        return respond({ ok: false, code: 'INVALID_INPUT' });
      return respond(await deleteCommunityComment(port, slug, parsed.data));
    }
    const parsed = communityLikeSchema.safeParse(body);
    if (!parsed.success || parsed.data.post_id !== postId)
      return respond({ ok: false, code: 'INVALID_INPUT' });
    return respond(await setCommunityLike(port, slug, parsed.data));
  } catch {
    return respond({ ok: false, code: 'UNAVAILABLE' });
  }
}
