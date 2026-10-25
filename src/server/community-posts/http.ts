import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  COMMUNITY_POSTS,
  COMMUNITY_ERROR_STATUS,
  communityCreateSchema,
  communityDeleteSchema,
  communityNoticeSchema,
  type CommunityResult,
} from '@/config/community-posts';
import { artistSlugSchema } from '@/config/artists';
import { createAuthContext } from '@/server/auth/context';
import { readSession } from '@/server/services/auth/session';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { createCommunityPostsPort } from '@/server/db/community-posts';
import {
  listCommunityPosts,
  getCommunityPost,
  resolveCommunityListQuery,
} from '@/server/services/community-posts/read';
import {
  createCommunityPost,
  deleteCommunityPost,
  setCommunityNotice,
} from '@/server/services/community-posts/manage';
import { communityPostsBody } from './security';
import { recordCommunityPostCreation } from '@/server/services/community-posts/analytics';
import { getCommunityPostAnalyticsPort } from './analytics';
export async function communityPostsHttp(
  request: NextRequest,
  action: 'list' | 'detail' | 'create' | 'delete' | 'notice',
  slug: unknown,
  postId?: unknown,
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
    const read = action === 'list' || action === 'detail',
      params = request.nextUrl.searchParams;
    if (
      (read ? request.method !== 'GET' : request.method !== 'POST') ||
      (action === 'list'
        ? [...params.keys()].some(
            (key) => key !== 'cursor' || params.getAll(key).length !== 1,
          )
        : params.size > 0) ||
      !artistSlugSchema.safeParse(slug).success
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
      request.headers.get(COMMUNITY_POSTS.actorHeader) !== state.profile.id ||
      (action === 'notice' && state.profile.role !== 'admin')
    )
      return respond({ ok: false, code: 'FORBIDDEN' });
    const port = createCommunityPostsPort(context.client);
    if (action === 'list') {
      const query = resolveCommunityListQuery({
        slug,
        ...Object.fromEntries(params),
      });
      return respond(
        query.ok
          ? await listCommunityPosts(port, query.data, state.profile.id)
          : query,
      );
    }
    if (action === 'detail')
      return respond(
        await getCommunityPost(
          port,
          { slug, post_id: postId },
          state.profile.id,
        ),
      );
    const body = await communityPostsBody(request);
    if (action === 'create') {
      const parsed = communityCreateSchema.safeParse(body);
      if (!parsed.success) return respond({ ok: false, code: 'INVALID_INPUT' });
      if (parsed.data.is_notice && state.profile.role !== 'admin')
        return respond({ ok: false, code: 'FORBIDDEN' });
      const result = await createCommunityPost(port, slug, parsed.data);
      if (result.ok) {
        // The immutable post receipt wins even if optional analytics is absent,
        // declined or unavailable. Explicit receipt retries reuse the event key.
        await recordCommunityPostCreation(getCommunityPostAnalyticsPort(), {
          actor_id: state.profile.id,
          event_key: parsed.data.operation_id,
          post_id: result.data.id,
        });
      }
      return respond(result);
    }
    if (action === 'delete') {
      const parsed = communityDeleteSchema.safeParse(body);
      if (!parsed.success || parsed.data.post_id !== postId)
        return respond({ ok: false, code: 'INVALID_INPUT' });
      return respond(await deleteCommunityPost(port, slug, parsed.data));
    }
    const parsed = communityNoticeSchema.safeParse(body);
    if (!parsed.success || parsed.data.post_id !== postId)
      return respond({ ok: false, code: 'INVALID_INPUT' });
    return respond(await setCommunityNotice(port, slug, parsed.data));
  } catch {
    return respond({ ok: false, code: 'UNAVAILABLE' });
  }
}
