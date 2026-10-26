import 'server-only';
import { z } from 'zod';
import {
  ATTENDANCE_POINTS,
  pointCursorSchema,
  pointSnapshotSchema,
  pointBefore,
  attendanceInputSchema,
  attendanceReceiptSchema,
  type PointCursor,
  type PointSnapshot,
  type AttendanceInput,
  type AttendanceReceipt,
  type PointsResult,
} from '@/config/attendance-points';
export type AttendancePointsPort = {
  snapshot(cursor: PointCursor | null): Promise<PointsResult<PointSnapshot>>;
  attend(input: AttendanceInput): Promise<PointsResult<AttendanceReceipt>>;
};
export function resolvePointCursor(
  input: unknown,
): PointsResult<PointCursor | null> {
  const parsed = z
    .strictObject({
      cursor: z.string().min(1).max(ATTENDANCE_POINTS.cursorMax).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const raw: unknown =
      parsed.data.cursor === undefined ? null : JSON.parse(parsed.data.cursor);
    const cursor = pointCursorSchema.nullable().safeParse(raw);
    return cursor.success
      ? { ok: true, data: cursor.data }
      : { ok: false, code: 'INVALID_INPUT' };
  } catch {
    return { ok: false, code: 'INVALID_INPUT' };
  }
}
export async function getPointSnapshot(
  port: AttendancePointsPort,
  cursor: unknown,
  actorId: string,
): Promise<PointsResult<PointSnapshot>> {
  const input = pointCursorSchema.nullable().safeParse(cursor);
  if (!input.success || !z.uuid().safeParse(actorId).success)
    return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.snapshot(input.data);
    if (!result.ok) return result;
    const parsed = pointSnapshotSchema.safeParse(result.data);
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
export async function recordAttendance(
  port: AttendancePointsPort,
  input: unknown,
  actorId: string,
): Promise<PointsResult<AttendanceReceipt>> {
  const parsed = attendanceInputSchema.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(actorId).success)
    return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.attend(parsed.data);
    if (!result.ok) return result;
    const receipt = attendanceReceiptSchema.safeParse(result.data);
    return receipt.success &&
      receipt.data.actor_id === actorId.toLowerCase() &&
      receipt.data.operation_id === parsed.data.operation_id
      ? { ok: true, data: receipt.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
