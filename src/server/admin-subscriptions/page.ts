import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { routes } from '@/config/routes';
import type { AdminSubscriptionResult } from '@/config/admin-subscriptions';
import { createAuthContext } from '@/server/auth/context';
import { readSession } from '@/server/services/auth/session';
import { isRestricted } from '@/server/services/auth/access';

async function pageIdentity(): Promise<AdminSubscriptionResult<string>> {
  const context = createAuthContext((await cookies()).getAll());
  const state = await readSession(context.port);
  if (state.status === 'anonymous') redirect(routes.start);
  if (state.status !== 'authenticated' || !context.client)
    return {
      ok: false,
      code: state.status === 'unconfigured' ? 'SETUP_NOT_READY' : 'UNAVAILABLE',
    };
  if (isRestricted(state.profile) || state.profile.role !== 'admin')
    return { ok: false, code: 'FORBIDDEN' };
  return { ok: true, data: state.profile.id };
}
// Private subscription aggregates never enter reusable RSC payloads. Mounted clients
// revalidate current authority on navigation, restoration and every request.
export async function getAdminSubscriptionPage(): Promise<
  AdminSubscriptionResult<{ key: string }>
> {
  const identity = await pageIdentity();
  return identity.ok ? { ok: true, data: { key: identity.data } } : identity;
}
