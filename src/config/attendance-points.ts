import { z } from 'zod';

// These are transport/UI bounds, never reward amounts or activated policy.
export const ATTENDANCE_POINTS = {
  pageSize: 20,
  timeZone: 'Asia/Seoul',
  actorHeader: 'x-trot-you-actor',
  cursorMax: 512,
  bodyLimit: 1024,
  bodyTimeoutMs: 5000,
  requestTimeoutMs: 15000,
  responseMaxBytes: 128 * 1024,
  httpOk: 200,
} as const;
export const POINTS_ERROR_STATUS = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  BALANCE_LIMIT: 409,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export type PointsError = keyof typeof POINTS_ERROR_STATUS;
export type PointsResult<T> =
  { ok: true; data: T } | { ok: false; code: PointsError };
const id = z.uuid().toLowerCase();
const instant = z.iso
  .datetime({ offset: true })
  .refine(
    (value) =>
      !value.startsWith('0000-') &&
      (value.match(/\.(\d+)/)?.[1]?.length ?? 0) <= 6,
  );
const date = z.iso.date().refine((value) => !value.startsWith('0000-'));
const amount = z.number().int().safe();
export const pointCursorSchema = z.strictObject({ created_at: instant, id });
export type PointCursor = z.output<typeof pointCursorSchema>;
function micros(value: string) {
  const fraction = value.match(/\.(\d+)/)?.[1] ?? '';
  return (
    BigInt(Date.parse(value)) * 1000n +
    BigInt(fraction.padEnd(6, '0').slice(3, 6))
  );
}
export function pointSameInstant(value: string, other: string) {
  return micros(value) === micros(other);
}
export function pointBefore(value: PointCursor, before: PointCursor) {
  const difference = micros(value.created_at) - micros(before.created_at);
  return (
    difference < 0n ||
    (difference === 0n && value.id.toLowerCase() < before.id.toLowerCase())
  );
}
export const pointEntrySchema = z
  .strictObject({
    id,
    amount,
    reason: z.enum(['attendance', 'post', 'comment', 'admin_adjust']),
    earned_on: date,
    created_at: instant,
  })
  .refine((entry) =>
    entry.reason === 'admin_adjust' ? entry.amount !== 0 : entry.amount >= 0,
  );
export type PointEntry = z.output<typeof pointEntrySchema>;
export const pointSnapshotSchema = z
  .strictObject({
    actor_id: id,
    kst_date: date,
    attendance_entry_id: id.nullable(),
    attendance_amount: amount.nonnegative().nullable(),
    balance: amount.nonnegative(),
    entries: z.array(pointEntrySchema).max(ATTENDANCE_POINTS.pageSize),
    next_cursor: pointCursorSchema.nullable(),
  })
  .refine((snapshot) => {
    const ids = new Set<string>();
    for (let index = 0; index < snapshot.entries.length; index += 1) {
      const entry = snapshot.entries[index]!;
      if (
        ids.has(entry.id) ||
        (index > 0 && !pointBefore(entry, snapshot.entries[index - 1]!))
      )
        return false;
      if (
        entry.id === snapshot.attendance_entry_id &&
        (entry.reason !== 'attendance' || entry.earned_on !== snapshot.kst_date)
      )
        return false;
      if (
        entry.reason === 'attendance' &&
        entry.earned_on === snapshot.kst_date &&
        entry.id !== snapshot.attendance_entry_id
      )
        return false;
      ids.add(entry.id);
    }
    const last = snapshot.entries.at(-1);
    return (
      snapshot.next_cursor === null ||
      (snapshot.entries.length === ATTENDANCE_POINTS.pageSize &&
        last !== undefined &&
        last.id === snapshot.next_cursor.id &&
        pointSameInstant(last.created_at, snapshot.next_cursor.created_at))
    );
  });
export type PointSnapshot = z.output<typeof pointSnapshotSchema>;
export const attendanceInputSchema = z.strictObject({ operation_id: id });
export type AttendanceInput = z.output<typeof attendanceInputSchema>;
export const attendanceReceiptSchema = z.strictObject({
  actor_id: id,
  operation_id: id,
  entry_id: id,
  earned_on: date,
  amount: amount.nonnegative(),
});
export type AttendanceReceipt = z.output<typeof attendanceReceiptSchema>;
