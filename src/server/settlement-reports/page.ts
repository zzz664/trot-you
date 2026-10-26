import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { routes } from '@/config/routes';
import type {
  SettlementReportMode,
  SettlementReportResult,
} from '@/config/settlement-reports';
import { createAuthContext } from '@/server/auth/context';
import { readSession } from '@/server/services/auth/session';
import { isRestricted } from '@/server/services/auth/access';
// Reusable RSC contains identity only, never private report or source snapshots.
export async function getSettlementReportsPage(
  mode: SettlementReportMode,
): Promise<SettlementReportResult<{ key: string }>> {
  const context = createAuthContext((await cookies()).getAll());
  const state = await readSession(context.port);
  if (state.status === 'anonymous') redirect(routes.start);
  if (state.status !== 'authenticated' || !context.client)
    return {
      ok: false,
      code: state.status === 'unconfigured' ? 'SETUP_NOT_READY' : 'UNAVAILABLE',
    };
  if (isRestricted(state.profile) || state.profile.role !== mode)
    return { ok: false, code: 'FORBIDDEN' };
  return { ok: true, data: { key: state.profile.id } };
}
