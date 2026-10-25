import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  WEBPUSH,
  WEBPUSH_ERROR_STATUS,
  type WebPushResult,
} from '@/config/webpush';
import { createAuthContext } from '@/server/auth/context';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import {
  readWebPushStatus,
  revokeWebPush,
  subscribeWebPush,
} from '@/server/services/notification/subscription';
import { createWebPushSubscriptionDependencies } from './dependencies';
import { verifiedWebPushActor, webPushBody } from './security';

export async function webPushHttp(request: NextRequest) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: WebPushResult<unknown>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok ? WEBPUSH.httpOk : WEBPUSH_ERROR_STATUS[result.code],
        headers: { 'X-Content-Type-Options': 'nosniff' },
      }),
    );
  try {
    if (!context.configuration || !context.client || !context.port)
      return respond({ ok: false, code: 'SETUP_NOT_READY' });
    if (
      request.nextUrl.search ||
      !['GET', 'POST', 'DELETE'].includes(request.method)
    )
      return respond({ ok: false, code: 'INVALID_INPUT' });
    if (
      request.method !== 'GET' &&
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
    const actor = await verifiedWebPushActor(context.client, state.profile.id);
    if (!actor) return respond({ ok: false, code: 'UNAUTHENTICATED' });
    const input =
      request.method === 'GET'
        ? { action: 'status', endpoint: null }
        : await webPushBody(request);
    const subscribing =
      request.method === 'POST' &&
      typeof input === 'object' &&
      input !== null &&
      'action' in input &&
      input.action === 'subscribe';
    if (
      subscribing &&
      (isRestricted(state.profile) ||
        state.profile.role !== 'fan' ||
        !state.profile.onboarding_completed_at)
    )
      return respond({ ok: false, code: 'FORBIDDEN' });
    const deps = createWebPushSubscriptionDependencies(context.client);
    if (!deps) return respond({ ok: false, code: 'SETUP_NOT_READY' });
    if (request.method === 'DELETE')
      return respond(await revokeWebPush(deps, actor, input));
    return respond(
      await (subscribing ? subscribeWebPush : readWebPushStatus)(
        deps,
        actor,
        input,
      ),
    );
  } catch {
    return respond({ ok: false, code: 'UNAVAILABLE' });
  }
}
