import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { routes } from '@/config/routes';
import type { AnalyticsFunnelResult } from '@/config/analytics-funnel';
import { createAuthContext } from '@/server/auth/context';
import { readSession } from '@/server/services/auth/session';
import { isRestricted } from '@/server/services/auth/access';
// Only current identity crosses reusable RSC; aggregates require a fresh private read.
export async function getAnalyticsFunnelPage(): Promise<
  AnalyticsFunnelResult<{ key: string }>
> {
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
  return { ok: true, data: { key: state.profile.id } };
}
