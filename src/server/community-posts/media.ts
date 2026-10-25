import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  COMMUNITY_POSTS,
  COMMUNITY_ERROR_STATUS,
  type CommunityResult,
} from '@/config/community-posts';
import { createAuthContext } from '@/server/auth/context';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import {
  beginCommunityImage,
  completeCommunityImage,
  revokeCommunityImage,
  readCommunityImage,
} from '@/server/services/community-posts/media';
import { createCommunityMediaDependencies } from './media-dependencies';
import { communityMediaJson } from './media-security';

export async function communityMediaHttp(
  request: NextRequest,
  action: 'begin' | 'complete' | 'revoke' | 'read',
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
    if (request.method !== 'POST' || request.nextUrl.search)
      return respond({ ok: false, code: 'INVALID_INPUT' });
    if (
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
    let body: unknown;
    try {
      body = await communityMediaJson(request);
    } catch {
      return respond({ ok: false, code: 'INVALID_INPUT' });
    }
    const deps = createCommunityMediaDependencies();
    if (!deps) return respond({ ok: false, code: 'SETUP_NOT_READY' });
    const operations = {
      begin: beginCommunityImage,
      complete: completeCommunityImage,
      revoke: revokeCommunityImage,
      read: readCommunityImage,
    };
    return respond(await operations[action](deps, state.profile.id, body));
  } catch {
    return respond({ ok: false, code: 'UNAVAILABLE' });
  }
}
