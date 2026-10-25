import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { routes } from '@/config/routes';
import type { WebPushResult, WebPushStatus } from '@/config/webpush';
import { createAuthContext } from '@/server/auth/context';
import { isRestricted, landingPath } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { readWebPushStatus } from '@/server/services/notification/subscription';
import { createWebPushSubscriptionDependencies } from './dependencies';
import { verifiedWebPushActor } from './security';

export async function getWebPushPage(): Promise<
  WebPushResult<{ initial: WebPushStatus; key: string }>
> {
  const context = createAuthContext((await cookies()).getAll());
  const state = await readSession(context.port);
  if (state.status === 'anonymous') redirect(routes.start);
  if (state.status !== 'authenticated' || !context.client)
    return {
      ok: false,
      code: state.status === 'unconfigured' ? 'SETUP_NOT_READY' : 'UNAVAILABLE',
    };
  if (isRestricted(state.profile)) redirect(routes.restricted);
  if (!state.profile.onboarding_completed_at) redirect(routes.onboarding);
  if (state.profile.role !== 'fan') redirect(landingPath(state.profile));
  const actor = await verifiedWebPushActor(context.client, state.profile.id);
  if (!actor) return { ok: false, code: 'UNAUTHENTICATED' };
  const deps = createWebPushSubscriptionDependencies(context.client);
  if (!deps) return { ok: false, code: 'SETUP_NOT_READY' };
  const result = await readWebPushStatus(deps, actor, {
    action: 'status',
    endpoint: null,
  });
  return result.ok
    ? { ok: true, data: { initial: result.data, key: actor.sessionId } }
    : result;
}
