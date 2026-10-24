import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { routes } from '@/config/routes';
import type {
  ComposeResult,
  ComposePageData,
  ComposeCatalog,
} from '@/config/artist-compose';
import { createAuthContext } from '@/server/auth/context';
import { createComposePort } from '@/server/db/artist-compose';
import {
  isRestricted,
  landingPath,
  pageRedirect,
} from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import {
  readComposeArtists,
  readComposeContext,
  type ComposePort,
} from '@/server/services/artist-compose/compose';

async function artistPort(menu = false): Promise<ComposeResult<ComposePort>> {
  const context = createAuthContext((await cookies()).getAll());
  const state = await readSession(context.port);
  if (menu) {
    const target = pageRedirect(state, routes.artist);
    if (target) redirect(target);
  }
  if (state.status === 'anonymous') redirect(routes.start);
  if (state.status !== 'authenticated' || !context.client)
    return {
      ok: false,
      code: state.status === 'unconfigured' ? 'SETUP_NOT_READY' : 'UNAVAILABLE',
    };
  if (isRestricted(state.profile)) redirect(routes.restricted);
  if (state.profile.role !== 'artist') redirect(landingPath(state.profile));
  if (!state.profile.onboarding_completed_at) redirect(routes.onboarding);
  return { ok: true, data: createComposePort(context.client) };
}
export async function getComposeMenu(
  after: unknown,
): Promise<ComposeResult<ComposeCatalog>> {
  const port = await artistPort(true);
  return port.ok ? readComposeArtists(port.data, after) : port;
}
export async function getComposePage(
  slug: unknown,
  messageId: unknown,
): Promise<ComposeResult<ComposePageData>> {
  const port = await artistPort();
  return port.ok ? readComposeContext(port.data, { slug, messageId }) : port;
}
