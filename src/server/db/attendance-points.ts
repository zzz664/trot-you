import 'server-only';
import { z } from 'zod';
import {
  ATTENDANCE_POINTS,
  pointSnapshotSchema,
  attendanceReceiptSchema,
  type PointsError,
  type PointsResult,
} from '@/config/attendance-points';
import type { AttendancePointsPort } from '@/server/services/attendance-points/manage';
import type { ActorClient } from './client';
const errors: Record<string, PointsError> = {
  COMMUNITY_FORBIDDEN: 'FORBIDDEN',
  POINT_ACTOR_REQUIRED: 'FORBIDDEN',
  POINT_POLICY_UNCONFIGURED: 'SETUP_NOT_READY',
  POINT_PAGE_INVALID: 'INVALID_INPUT',
  POINT_INVALID_INPUT: 'INVALID_INPUT',
  POINT_OPERATION_REQUIRED: 'INVALID_INPUT',
  POINT_IDEMPOTENCY_CONFLICT: 'CONFLICT',
  POINT_BALANCE_OUT_OF_RANGE: 'BALANCE_LIMIT',
};
function parsed<T>(
  schema: z.ZodType<T>,
  data: unknown,
  error: { message: string } | null,
): PointsResult<T> {
  if (error)
    return {
      ok: false,
      code: Object.hasOwn(errors, error.message)
        ? errors[error.message]!
        : 'UNAVAILABLE',
    };
  const result = schema.safeParse(data);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, code: 'UNAVAILABLE' };
}
export function createAttendancePointsPort(
  client: ActorClient,
): AttendancePointsPort {
  return {
    async snapshot(cursor) {
      const { data, error } = await client.rpc('point_ui_snapshot', {
        p_limit: ATTENDANCE_POINTS.pageSize,
        ...(cursor === null
          ? {}
          : { p_before_created_at: cursor.created_at, p_before_id: cursor.id }),
      });
      return parsed(pointSnapshotSchema, data, error);
    },
    async attend(input) {
      const { data, error } = await client.rpc('point_ui_check_attendance', {
        p_operation_id: input.operation_id,
      });
      return parsed(attendanceReceiptSchema, data, error);
    },
  };
}
