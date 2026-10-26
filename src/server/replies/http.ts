import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  REPLY_ERROR_STATUS,
  REPLY_HTTP_OK,
  type ReplyResult,
} from '@/config/replies';
import { AnalyticsEvent } from '@/config/analytics-events';
import { captureServerEvent } from '@/server/services/analytics/capture';
import { getAnalyticsCapturePort } from '@/server/analytics/capture';
import { createAuthContext } from '@/server/auth/context';
import { createReplyPort } from '@/server/db/replies';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { readReplyPage, sendReply } from '@/server/services/replies/replies';
import { replyWriteBody } from './security';

type Context = ReturnType<typeof createAuthContext>;
function respond(context: Context, result: ReplyResult<unknown>) {
  return context.apply(
    NextResponse.json(result, {
      status: result.ok ? REPLY_HTTP_OK : REPLY_ERROR_STATUS[result.code],
      headers: { 'X-Content-Type-Options': 'nosniff' },
    }),
  );
}
async function subject(context: Context): Promise<ReplyResult<string>> {
  if (!context.configuration || !context.client || !context.port)
    return { ok: false, code: 'SETUP_NOT_READY' };
  const state = await readSession(context.port);
  if (state.status !== 'authenticated')
    return {
      ok: false,
      code: state.status === 'unavailable' ? 'UNAVAILABLE' : 'UNAUTHENTICATED',
    };
  if (isRestricted(state.profile) || state.profile.role !== 'fan')
    return { ok: false, code: 'FORBIDDEN' };
  if (!state.profile.onboarding_completed_at)
    return { ok: false, code: 'PROFILE_REQUIRED' };
  return { ok: true, data: state.profile.id };
}
export async function repliesGet(request: NextRequest, slug: unknown) {
  const context = createAuthContext(request.cookies.getAll());
  const actor = await subject(context);
  if (!actor.ok) return respond(context, actor);
  const query = request.nextUrl.searchParams;
  if (
    [...query.keys()].some((key) => !['cursor', 'limit'].includes(key)) ||
    query.getAll('cursor').length > 1 ||
    query.getAll('limit').length > 1
  )
    return respond(context, { ok: false, code: 'INVALID_INPUT' });
  const value = query.get('limit');
  if (value !== null && !/^[1-9][0-9]*$/.test(value))
    return respond(context, { ok: false, code: 'INVALID_INPUT' });
  return respond(
    context,
    await readReplyPage(createReplyPort(context.client!), {
      slug,
      ...(query.has('cursor') ? { cursor: query.get('cursor') } : {}),
      ...(value !== null ? { limit: Number(value) } : {}),
    }),
  );
}
export async function repliesPost(request: NextRequest, slug: unknown) {
  const context = createAuthContext(request.cookies.getAll());
  if (!context.configuration || !context.client || !context.port)
    return respond(context, { ok: false, code: 'SETUP_NOT_READY' });
  if (
    !isSameOriginPost(
      request.headers.get('origin'),
      context.configuration.appOrigin,
    )
  )
    return respond(context, { ok: false, code: 'FORBIDDEN' });
  if (request.nextUrl.search)
    return respond(context, { ok: false, code: 'INVALID_INPUT' });
  const actor = await subject(context);
  if (!actor.ok) return respond(context, actor);
  const body = await replyWriteBody(request);
  if (!body) return respond(context, { ok: false, code: 'INVALID_INPUT' });
  const result = await sendReply(createReplyPort(context.client), {
    ...body,
    slug,
  });
  if (result.ok && !result.data.reply.blocked)
    await captureServerEvent(
      getAnalyticsCapturePort(),
      {
        actor_id: actor.data,
        event: {
          name: AnalyticsEvent.REPLY_SENT,
          event_key: result.data.reply.id,
          properties: { source_id: result.data.reply.id },
        },
      },
      request.signal,
    );
  return respond(context, result);
}
