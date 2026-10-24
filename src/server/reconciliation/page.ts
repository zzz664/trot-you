import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { routes } from '@/config/routes';
import { createAuthContext } from '@/server/auth/context';
import { createReconciliationAdminDbPort } from '@/server/db/reconciliation-admin';
import { isRestricted, landingPath } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { listAdminReconciliation } from '@/server/services/reconciliation/admin';
import type {
  ReconciliationAdminList,
  ReconciliationAdminResult,
} from '@/config/reconciliation-admin';

export async function getAdminReconciliationPage(
  page: unknown = 1,
): Promise<ReconciliationAdminResult<ReconciliationAdminList>> {
  const context = createAuthContext((await cookies()).getAll());
  const state = await readSession(context.port);
  if (state.status === 'anonymous') redirect(routes.start);
  if (state.status !== 'authenticated' || !context.client)
    return {
      ok: false,
      code: state.status === 'unconfigured' ? 'SETUP_NOT_READY' : 'UNAVAILABLE',
    };
  // Fresh actor-token authority at every navigation/refresh; the RPC separately
  // checks the current database role and restriction, not a stale JWT role.
  if (isRestricted(state.profile) || state.profile.role !== 'admin')
    redirect(landingPath(state.profile));
  return listAdminReconciliation(
    createReconciliationAdminDbPort(context.client),
    page,
  );
}
