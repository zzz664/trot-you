import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  ANALYTICS_ERROR_STATUS,
  ANALYTICS_HTTP_OK,
  ANALYTICS_PREVIEW_ACTOR_HEADER,
  type AnalyticsResult,
} from '@/config/analytics';
import { AnalyticsEvent } from '@/config/analytics-events';
import { createAuthContext } from '@/server/auth/context';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { captureServerEvent } from '@/server/services/analytics/capture';
import { getAnalyticsCapturePort } from './capture';
import { previewAnalyticsBody } from './security';

export async function previewAnalyticsPost(request: NextRequest) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: AnalyticsResult<null>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok
          ? ANALYTICS_HTTP_OK
          : ANALYTICS_ERROR_STATUS[result.code],
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
  if (isRestricted(state.profile) || state.profile.role !== 'fan')
    return respond({ ok: false, code: 'FORBIDDEN' });
  if (!state.profile.onboarding_completed_at)
    return respond({ ok: false, code: 'PROFILE_REQUIRED' });
  // The header only asserts the render's own actor; it never supplies authority.
  if (request.headers.get(ANALYTICS_PREVIEW_ACTOR_HEADER) !== state.profile.id)
    return respond({ ok: false, code: 'FORBIDDEN' });
  const body = await previewAnalyticsBody(request);
  if (!body) return respond({ ok: false, code: 'INVALID_INPUT' });
  return respond(
    await captureServerEvent(
      getAnalyticsCapturePort(),
      {
        actor_id: state.profile.id,
        event: {
          name: AnalyticsEvent.PREVIEW_VIEW,
          event_key: body.event_key,
          properties: { source_id: body.source_id },
        },
      },
      request.signal,
    ),
  );
}
