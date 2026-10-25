import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { routes } from '@/config/routes';
import type {
  ArtistReplyActivityCatalog,
  ArtistReplyActivityPage,
  ArtistReplyActivityResult,
} from '@/config/artist-reply-activity';
import { createAuthContext } from '@/server/auth/context';
import {
  createArtistReplyActivityCatalogPort,
  createArtistReplyActivityPort,
} from '@/server/db/artist-reply-activity';
import type { ActorClient } from '@/server/db/client';
import { isRestricted, landingPath } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import {
  readArtistReplyActivityArtists,
  readArtistReplyActivityPage,
} from '@/server/services/artist-reply-activity/activity';

async function activityClient(): Promise<
  ArtistReplyActivityResult<ActorClient>
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
  if (state.profile.role !== 'artist') redirect(landingPath(state.profile));
  if (!state.profile.onboarding_completed_at) redirect(routes.onboarding);
  return { ok: true, data: context.client };
}

export async function getArtistReplyActivityMenu(
  after: unknown,
): Promise<ArtistReplyActivityResult<ArtistReplyActivityCatalog>> {
  const client = await activityClient();
  return client.ok
    ? readArtistReplyActivityArtists(
        createArtistReplyActivityCatalogPort(client.data),
        after,
      )
    : client;
}

export async function getArtistReplyActivityPage(
  slug: unknown,
  messageId: unknown = null,
  cursor?: unknown,
): Promise<ArtistReplyActivityResult<ArtistReplyActivityPage>> {
  const client = await activityClient();
  return client.ok
    ? readArtistReplyActivityPage(createArtistReplyActivityPort(client.data), {
        slug,
        messageId,
        ...(cursor !== undefined ? { cursor } : {}),
      })
    : client;
}
