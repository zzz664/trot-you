import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  ANALYTICS_ERROR_STATUS,
  ANALYTICS_HTTP_OK,
  type AnalyticsResult,
} from '@/config/analytics';
import { createAuthContext } from '@/server/auth/context';
import { createAnalyticsPort } from '@/server/db/analytics';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { track } from '@/server/services/analytics/track';
import { analyticsBody } from './security';

type Context = ReturnType<typeof createAuthContext>;
function respond(context: Context, result: AnalyticsResult<null>) {
  return context.apply(
    NextResponse.json(result, {
      status: result.ok
        ? ANALYTICS_HTTP_OK
        : ANALYTICS_ERROR_STATUS[result.code],
      headers: { 'X-Content-Type-Options': 'nosniff' },
    }),
  );
}
export async function analyticsPost(request: NextRequest) {
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
  const state = await readSession(context.port);
  if (state.status !== 'authenticated')
    return respond(context, {
      ok: false,
      code: state.status === 'unavailable' ? 'UNAVAILABLE' : 'UNAUTHENTICATED',
    });
  if (isRestricted(state.profile) || state.profile.role !== 'fan')
    return respond(context, { ok: false, code: 'FORBIDDEN' });
  if (!state.profile.onboarding_completed_at)
    return respond(context, { ok: false, code: 'PROFILE_REQUIRED' });
  const input = await analyticsBody(request);
  if (!input) return respond(context, { ok: false, code: 'INVALID_INPUT' });
  return respond(
    context,
    await track(createAnalyticsPort(context.client), input, request.signal),
  );
}
