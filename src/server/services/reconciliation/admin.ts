import 'server-only';
import {
  reconciliationAdminListSchema,
  reconciliationAdminPageSchema,
  type ReconciliationAdminList,
  type ReconciliationAdminResult,
} from '@/config/reconciliation-admin';

export type ReconciliationAdminDbPort = {
  list(
    page: number,
  ): Promise<ReconciliationAdminResult<ReconciliationAdminList>>;
};

export async function listAdminReconciliation(
  db: ReconciliationAdminDbPort,
  page: unknown = 1,
): Promise<ReconciliationAdminResult<ReconciliationAdminList>> {
  const parsed = reconciliationAdminPageSchema.safeParse(page);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await db.list(parsed.data);
    if (!result.ok) return result;
    // Parse again at the service boundary: neither a malformed projection nor
    // accidental extra private fields may be serialized to client components.
    const data = reconciliationAdminListSchema.safeParse(result.data);
    return data.success && data.data.page === parsed.data
      ? { ok: true, data: data.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
