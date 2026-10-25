import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { routes } from '@/config/routes';
import type { ScheduleResult } from '@/config/schedules';
import { createAuthContext } from '@/server/auth/context';
import { readSession } from '@/server/services/auth/session';
import { isRestricted } from '@/server/services/auth/access';

// Only a session mount key enters RSC. Membership and draft events are fetched
// with no-store and current authority, including browser history restoration.
export async function getSchedulePage(
  admin = false,
): Promise<ScheduleResult<{ key: string }>> {
  const context = createAuthContext((await cookies()).getAll());
  const state = await readSession(context.port);
  if (state.status === 'anonymous') redirect(routes.start);
  if (state.status !== 'authenticated' || !context.client)
    return {
      ok: false,
      code: state.status === 'unconfigured' ? 'SETUP_NOT_READY' : 'UNAVAILABLE',
    };
  if (isRestricted(state.profile) || (admin && state.profile.role !== 'admin'))
    return { ok: false, code: 'FORBIDDEN' };
  if (state.profile.role === 'fan' && !state.profile.onboarding_completed_at)
    redirect(routes.onboarding);
  return { ok: true, data: { key: state.profile.id } };
}
