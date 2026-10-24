import 'server-only';
import { z } from 'zod';
import {
  RECONCILIATION_ADMIN_LIMIT,
  reconciliationAdminListSchema,
} from '@/config/reconciliation-admin';
import type { ActorClient } from './client';
import type { ReconciliationAdminDbPort } from '@/server/services/reconciliation/admin';

export function createReconciliationAdminDbPort(
  client: ActorClient,
): ReconciliationAdminDbPort {
  return {
    async list(page) {
      const { data, error } = await client.rpc('reconciliation_admin_list', {
        p_page: page,
        p_limit: RECONCILIATION_ADMIN_LIMIT,
      });
      if (error) {
        const result = z.object({ message: z.string() }).safeParse(error);
        return {
          ok: false,
          code:
            result.success && result.data.message === 'FORBIDDEN'
              ? 'FORBIDDEN'
              : 'UNAVAILABLE',
        };
      }
      const parsed = reconciliationAdminListSchema.safeParse(data);
      return parsed.success
        ? { ok: true, data: parsed.data }
        : { ok: false, code: 'UNAVAILABLE' };
    },
  };
}
