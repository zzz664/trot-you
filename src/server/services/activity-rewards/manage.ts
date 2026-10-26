import 'server-only';
import { z } from 'zod';
import {
  activitySnapshotSchema,
  type ActivitySnapshot,
} from '@/config/activity-rewards';
import {
  pointCursorSchema,
  pointBefore,
  type PointCursor,
  type PointsResult,
} from '@/config/attendance-points';

export { resolvePointCursor as resolveActivityCursor } from '@/server/services/attendance-points/manage';
export type ActivityRewardsPort = {
  snapshot(cursor: PointCursor | null): Promise<PointsResult<ActivitySnapshot>>;
};
export async function getActivitySnapshot(
  port: ActivityRewardsPort,
  cursor: unknown,
  actorId: string,
): Promise<PointsResult<ActivitySnapshot>> {
  const input = pointCursorSchema.nullable().safeParse(cursor);
  if (!input.success || !z.uuid().safeParse(actorId).success)
    return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.snapshot(input.data);
    if (!result.ok) return result;
    const parsed = activitySnapshotSchema.safeParse(result.data);
    return parsed.success &&
      parsed.data.actor_id === actorId.toLowerCase() &&
      (input.data === null ||
        parsed.data.entries.every((entry) => pointBefore(entry, input.data!)))
      ? { ok: true, data: parsed.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
