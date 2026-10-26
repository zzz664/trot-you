import 'server-only';
import {
  analyticsFunnelDashboardSchema,
  type AnalyticsFunnelError,
} from '@/config/analytics-funnel';
import type { AnalyticsFunnelPort } from '@/server/services/analytics-funnel/read';
import type { ActorClient } from './client';
const errors: Record<string, AnalyticsFunnelError> = {
  ANALYTICS_DASHBOARD_FORBIDDEN: 'FORBIDDEN',
  ANALYTICS_DASHBOARD_INVALID_INPUT: 'INVALID_INPUT',
};
export function createAnalyticsFunnelPort(
  client: ActorClient,
): AnalyticsFunnelPort {
  return {
    async read(query) {
      const { data, error } = await client.rpc('admin_analytics_dashboard', {
        p_from: query.from,
        p_to: query.to,
      });
      if (error)
        return {
          ok: false,
          code: Object.hasOwn(errors, error.message)
            ? errors[error.message]!
            : 'UNAVAILABLE',
        };
      const parsed = analyticsFunnelDashboardSchema.safeParse(data);
      return parsed.success
        ? { ok: true, data: parsed.data }
        : { ok: false, code: 'UNAVAILABLE' };
    },
  };
}
