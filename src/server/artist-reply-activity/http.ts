import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  ACTIVITY_ERROR_STATUS,
  ACTIVITY_HTTP_OK,
  type ArtistReplyActivityResult,
} from '@/config/artist-reply-activity';
import { createAuthContext } from '@/server/auth/context';
import { createArtistReplyActivityPort } from '@/server/db/artist-reply-activity';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import {
  readArtistReplyActivityPage,
  readArtistReplyActivityMessages,
} from '@/server/services/artist-reply-activity/activity';
import { artistReplyActivityBody } from './security';

export async function artistReplyActivityPost(
  request: NextRequest,
  slug: unknown,
  action: 'context' | 'messages',
) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: ArtistReplyActivityResult<unknown>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok
          ? ACTIVITY_HTTP_OK
          : ACTIVITY_ERROR_STATUS[result.code],
        headers: { 'X-Content-Type-Options': 'nosniff' },
      }),
    );
  if (!context.configuration || !context.client || !context.port)
    return respond({ ok: false, code: 'SETUP_NOT_READY' });
  if (
    !isSameOriginPost(
      request.headers.get('origin'),
      context.configuration.appOrigin,
    )
  )
    return respond({ ok: false, code: 'FORBIDDEN' });
  if (request.nextUrl.search)
    return respond({ ok: false, code: 'INVALID_INPUT' });
  const state = await readSession(context.port);
  if (state.status !== 'authenticated')
    return respond({
      ok: false,
      code: state.status === 'unavailable' ? 'UNAVAILABLE' : 'UNAUTHENTICATED',
    });
  if (
    isRestricted(state.profile) ||
    state.profile.role !== 'artist' ||
    !state.profile.onboarding_completed_at
  )
    return respond({ ok: false, code: 'FORBIDDEN' });
  const body = await artistReplyActivityBody(request);
  if (!body || Object.hasOwn(body, 'slug'))
    return respond({ ok: false, code: 'INVALID_INPUT' });
  const operation = {
    context: readArtistReplyActivityPage,
    messages: readArtistReplyActivityMessages,
  }[action];
  return respond(
    await operation(createArtistReplyActivityPort(context.client), {
      ...body,
      slug,
    }),
  );
}
