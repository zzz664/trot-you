import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  CHAT_ERROR_STATUS,
  CHAT_HTTP_OK,
  type ChatResult,
} from '@/config/chat';
import { AnalyticsEvent } from '@/config/analytics-events';
import { createAnalyticsPort } from '@/server/db/analytics';
import { track } from '@/server/services/analytics/track';
import { createAuthContext } from '@/server/auth/context';
import { createChatServiceClient } from '@/server/db/chat-client';
import { createChatPagePort, createChatReadPort } from '@/server/db/chat';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { readChatPage, markChatRead } from '@/server/services/chat/read';
import { chatReadBody } from './security';

type Context = ReturnType<typeof createAuthContext>;
function respond(context: Context, result: ChatResult<unknown>) {
  return context.apply(
    NextResponse.json(result, {
      status: result.ok ? CHAT_HTTP_OK : CHAT_ERROR_STATUS[result.code],
      headers: { 'X-Content-Type-Options': 'nosniff' },
    }),
  );
}
async function subject(context: Context): Promise<ChatResult<string>> {
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
export async function chatMessagesGet(request: NextRequest, slug: unknown) {
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
  const service = createChatServiceClient();
  if (!service) return respond(context, { ok: false, code: 'SETUP_NOT_READY' });
  const result = await readChatPage(createChatPagePort(service), actor.data, {
    slug,
    ...(query.has('cursor') ? { cursor: query.get('cursor') } : {}),
    ...(value !== null ? { limit: Number(value) } : {}),
  });
  // The HTML route may intentionally show a preview. Pagination never silently
  // downgrades a paid feed into a different dataset after access is lost.
  return respond(
    context,
    result.ok && !result.data.hasAccess
      ? { ok: false, code: 'SUBSCRIPTION_REQUIRED' }
      : result,
  );
}
export async function chatReadPost(
  request: NextRequest,
  slug: unknown,
  messageId: unknown,
) {
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
  if (!(await chatReadBody(request)))
    return respond(context, { ok: false, code: 'INVALID_INPUT' });
  const result = await markChatRead(createChatReadPort(context.client), {
    slug,
    messageId,
  });
  if (result.ok)
    await track(
      createAnalyticsPort(context.client),
      {
        event_key: result.data.messageId,
        name: AnalyticsEvent.MESSAGE_OPEN,
        properties: { source_id: result.data.messageId },
      },
      request.signal,
    );
  // Same request-bound actor capability owns both operations. A cookie switch
  // after this response cannot attribute A's read to B in a second request.
  return respond(context, result);
}
