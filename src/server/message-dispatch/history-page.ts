import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { routes } from '@/config/routes';
import type {
  DispatchCatalog,
  DispatchPageData,
  DispatchResult,
} from '@/config/message-dispatch';
import { createAuthContext } from '@/server/auth/context';
import {
  createDispatchCatalogPort,
  createDispatchPort,
} from '@/server/db/message-dispatch';
import type { ActorClient } from '@/server/db/client';
import { isRestricted, landingPath } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { readDispatchArtists } from '@/server/services/message-dispatch/catalog';
import { readDispatchContext } from '@/server/services/message-dispatch/dispatch';

async function historyClient(): Promise<DispatchResult<ActorClient>> {
  const context = createAuthContext((await cookies()).getAll());
  const state = await readSession(context.port);
  if (state.status === 'anonymous') redirect(routes.start);
  if (state.status !== 'authenticated' || !context.client)
    return {
      ok: false,
      code: state.status === 'unconfigured' ? 'SETUP_NOT_READY' : 'UNAVAILABLE',
    };
  if (isRestricted(state.profile)) redirect(routes.restricted);
  if (state.profile.role !== 'artist') redirect(landingPath(state.profile));
  if (!state.profile.onboarding_completed_at) redirect(routes.onboarding);
  return { ok: true, data: context.client };
}
export async function getDispatchHistoryMenu(
  after: unknown,
): Promise<DispatchResult<DispatchCatalog>> {
  const client = await historyClient();
  return client.ok
    ? readDispatchArtists(createDispatchCatalogPort(client.data), after)
    : client;
}
export async function getDispatchHistoryPage(
  slug: unknown,
): Promise<DispatchResult<DispatchPageData>> {
  const client = await historyClient();
  return client.ok
    ? readDispatchContext(createDispatchPort(client.data), {
        slug,
        messageId: null,
      })
    : client;
}
