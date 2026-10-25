import 'server-only';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { routes } from '@/config/routes';
import type { AdminArtistResult } from '@/config/admin-artists';
import { createAuthContext } from '@/server/auth/context';
import { readSession } from '@/server/services/auth/session';
import { isRestricted } from '@/server/services/auth/access';
import { parseAdminArtistPage } from '@/server/services/admin-artists/manage';

async function pageIdentity(
  admin: boolean,
): Promise<AdminArtistResult<string>> {
  const context = createAuthContext((await cookies()).getAll());
  const state = await readSession(context.port);
  if (state.status === 'anonymous') redirect(routes.start);
  if (state.status !== 'authenticated' || !context.client)
    return {
      ok: false,
      code: state.status === 'unconfigured' ? 'SETUP_NOT_READY' : 'UNAVAILABLE',
    };
  if (
    isRestricted(state.profile) ||
    (admin ? state.profile.role !== 'admin' : state.profile.role === 'admin')
  )
    return { ok: false, code: 'FORBIDDEN' };
  return { ok: true, data: state.profile.id };
}
// Only actor identity/navigation enters RSC; private snapshots are freshly read
// by mounted clients after navigation and browser history restore.
export async function getAdminArtistsPage(
  input: { id?: unknown; page?: unknown } = {},
): Promise<
  AdminArtistResult<{ key: string; id: string | null; page: number }>
> {
  const identity = await pageIdentity(true);
  if (!identity.ok) return identity;
  const page = parseAdminArtistPage(input.page);
  if (!page.ok) return page;
  if (
    input.id !== undefined &&
    input.id !== 'new' &&
    !z.uuid().safeParse(input.id).success
  )
    return { ok: false, code: 'INVALID_INPUT' };
  return {
    ok: true,
    data: {
      key: identity.data,
      id: typeof input.id === 'string' ? input.id : null,
      page: page.data,
    },
  };
}
export async function getArtistAccessPage(
  pageInput?: unknown,
): Promise<AdminArtistResult<{ key: string; page: number }>> {
  const identity = await pageIdentity(false);
  if (!identity.ok) return identity;
  const page = parseAdminArtistPage(pageInput);
  return page.ok
    ? { ok: true, data: { key: identity.data, page: page.data } }
    : page;
}
