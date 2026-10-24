import 'server-only';
import { z } from 'zod';
import type { ReconciliationResult } from '@/config/reconciliation';
import { reconcilePayments, type ReconciliationDependencies } from './process';

export type InitialRecoveryDependencies = ReconciliationDependencies & {
  enrollmentCase(
    actorId: string,
    sessionId: string,
  ): Promise<ReconciliationResult<string>>;
};
export async function recoverInitialPayment(
  deps: InitialRecoveryDependencies,
  actorId: string,
  sessionId: string,
): Promise<ReconciliationResult<null>> {
  const unavailable = { ok: false, code: 'UNAVAILABLE' } as const;
  if (
    !z.uuid().safeParse(actorId).success ||
    !z.uuid().safeParse(sessionId).success
  )
    return unavailable;
  try {
    const found = await deps.enrollmentCase(actorId, sessionId);
    if (!found.ok || !z.uuid().safeParse(found.data).success)
      return unavailable;
    const result = await reconcilePayments({
      ...deps,
      db: {
        ...deps.db,
        candidates: async () => ({ ok: true, data: [found.data] }),
        async read(caseId) {
          const row = await deps.db.read(caseId);
          return row.ok &&
            row.data.kind === 'initial' &&
            row.data.target_id === sessionId
            ? row
            : unavailable;
        },
      },
    });
    return result.ok ? { ok: true, data: null } : result;
  } catch {
    return unavailable;
  }
}
