import type {
  PointSnapshot,
  PointEntry,
  AttendanceInput,
  AttendanceReceipt,
} from '@/config/attendance-points';
export const pointsActor = '10000000-0000-4000-8000-000000000001';
export const pointsOther = '10000000-0000-4000-8000-000000000002';
export const pointsTime = '2026-10-26T06:00:00.123456+00:00';
export const pointEntry: PointEntry = {
  id: '10000000-0000-4000-8000-000000000003',
  amount: 10,
  reason: 'attendance',
  earned_on: '2026-10-26',
  created_at: pointsTime,
};
export const pointSnapshot: PointSnapshot = {
  actor_id: pointsActor,
  kst_date: '2026-10-26',
  attendance_entry_id: pointEntry.id,
  attendance_amount: 10,
  balance: 10,
  entries: [pointEntry],
  next_cursor: null,
};
export const attendanceInput: AttendanceInput = {
  operation_id: '10000000-0000-4000-8000-000000000004',
};
export const attendanceReceipt: AttendanceReceipt = {
  actor_id: pointsActor,
  ...attendanceInput,
  entry_id: pointEntry.id,
  earned_on: pointEntry.earned_on,
  amount: pointEntry.amount,
};
export function pointPage(count = 20): PointSnapshot {
  const entries = Array.from({ length: count }, (_, index) => ({
    ...pointEntry,
    reason: 'post' as const,
    id: `20000000-0000-4000-8000-${String(count - index).padStart(12, '0')}`,
  }));
  const last = entries.at(-1);
  return {
    ...pointSnapshot,
    attendance_entry_id: null,
    entries,
    next_cursor: last ? { created_at: last.created_at, id: last.id } : null,
  };
}
