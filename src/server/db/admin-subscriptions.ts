import 'server-only';
import {
  adminSubscriptionDashboardSchema,
  type AdminSubscriptionError,
} from '@/config/admin-subscriptions';
import type { AdminSubscriptionPort } from '@/server/services/admin-subscriptions/read';
import type { ActorClient } from './client';
const errors: Record<string, AdminSubscriptionError> = {
  ADMIN_SUBSCRIPTIONS_FORBIDDEN: 'FORBIDDEN',
  ADMIN_SUBSCRIPTIONS_INVALID_INPUT: 'INVALID_INPUT',
  ADMIN_SUBSCRIPTIONS_NOT_FOUND: 'NOT_FOUND',
  ADMIN_SUBSCRIPTIONS_ISOLATION_UNSUPPORTED: 'UNAVAILABLE',
};
export function createAdminSubscriptionPort(
  client: ActorClient,
): AdminSubscriptionPort {
  return {
    async read(query) {
      const { data, error } = await client.rpc('admin_subscription_dashboard', {
        p_from: query.from,
        p_to: query.to,
        ...(query.artist_id ? { p_artist_id: query.artist_id } : {}),
        p_page: query.page,
      });
      if (error)
        return {
          ok: false,
          code: Object.hasOwn(errors, error.message)
            ? errors[error.message]!
            : 'UNAVAILABLE',
        };
      const result = adminSubscriptionDashboardSchema.safeParse(data);
      if (
        !result.success ||
        result.data.from !== query.from ||
        result.data.to !== query.to ||
        result.data.page !== query.page ||
        (result.data.selected_artist?.id ?? null) !== query.artist_id
      )
        return { ok: false, code: 'UNAVAILABLE' };
      return { ok: true, data: result.data };
    },
  };
}
