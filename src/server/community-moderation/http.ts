import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  COMMUNITY_POSTS,
  COMMUNITY_ERROR_STATUS,
  type CommunityResult,
} from '@/config/community-posts';
import { moderationTargetSchema } from '@/config/community-moderation';
import { createAuthContext } from '@/server/auth/context';
import { readSession } from '@/server/services/auth/session';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { createCommunityModerationPort } from '@/server/db/community-moderation';
import {
  getModerationContext,
  listModerationQueue,
  listModerationNotices,
  reportCommunityTarget,
  resolveModerationReport,
  restrictModerationUser,
  resolveModerationCursor,
} from '@/server/services/community-moderation/manage';
import { communityPostsBody } from '@/server/community-posts/security';
export type ModerationAction =
  'context' | 'report' | 'queue' | 'resolve' | 'restrict' | 'notices';
export async function communityModerationHttp(
  request: NextRequest,
  action: ModerationAction,
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
    const read =
      action === 'context' || action === 'queue' || action === 'notices';
    const admin =
      action === 'queue' || action === 'resolve' || action === 'restrict';
    const params = request.nextUrl.searchParams;
    const permitted =
      action === 'context'
        ? ['target_type', 'target_id']
        : read
          ? ['cursor']
          : [];
    if (
      request.method !== (read ? 'GET' : 'POST') ||
      [...params.keys()].some(
        (key) => !permitted.includes(key) || params.getAll(key).length !== 1,
      )
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
      (admin && state.profile.role !== 'admin') ||
      (state.profile.role === 'fan' &&
        !state.profile.onboarding_completed_at) ||
      request.headers.get(COMMUNITY_POSTS.actorHeader) !== state.profile.id
    )
      return respond({ ok: false, code: 'FORBIDDEN' });
    const port = createCommunityModerationPort(context.client);
    if (action === 'context') {
      const target = moderationTargetSchema.safeParse(
        Object.fromEntries(params),
      );
      return respond(
        target.success
          ? await getModerationContext(port, target.data, state.profile.id)
          : { ok: false, code: 'INVALID_INPUT' },
      );
    }
    if (action === 'queue' || action === 'notices') {
      const cursor = resolveModerationCursor(Object.fromEntries(params));
      return respond(
        !cursor.ok
          ? cursor
          : action === 'queue'
            ? await listModerationQueue(port, cursor.data, state.profile.id)
            : await listModerationNotices(port, cursor.data, state.profile.id),
      );
    }
    const body = await communityPostsBody(request);
    return respond(
      action === 'report'
        ? await reportCommunityTarget(port, body)
        : action === 'resolve'
          ? await resolveModerationReport(port, body)
          : await restrictModerationUser(port, body),
    );
  } catch {
    // Report reasons, source contents and session identifiers are never logged.
    return respond({ ok: false, code: 'UNAVAILABLE' });
  }
}
