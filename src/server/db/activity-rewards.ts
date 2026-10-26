import 'server-only';
import {
  ACTIVITY_REWARDS,
  activitySnapshotSchema,
} from '@/config/activity-rewards';
import type { PointsError } from '@/config/attendance-points';
import type { ActivityRewardsPort } from '@/server/services/activity-rewards/manage';
import type { ActorClient } from './client';

const errors: Record<string, PointsError> = {
  COMMUNITY_FORBIDDEN: 'FORBIDDEN',
  POINT_ACTOR_REQUIRED: 'FORBIDDEN',
  POINT_PAGE_INVALID: 'INVALID_INPUT',
};
export function createActivityRewardsPort(
  client: ActorClient,
): ActivityRewardsPort {
  return {
    async snapshot(cursor) {
      const { data, error } = await client.rpc('point_ui_activity', {
        p_limit: ACTIVITY_REWARDS.pageSize,
        ...(cursor === null
          ? {}
          : { p_before_created_at: cursor.created_at, p_before_id: cursor.id }),
      });
      if (error)
        return {
          ok: false,
          code: Object.hasOwn(errors, error.message)
            ? errors[error.message]!
            : 'UNAVAILABLE',
        };
      const result = activitySnapshotSchema.safeParse(data);
      return result.success
        ? { ok: true, data: result.data }
        : { ok: false, code: 'UNAVAILABLE' };
    },
  };
}
