// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { ATTENDANCE_POINTS } from '@/config/attendance-points';
import { createAttendancePointsPort } from '@/server/db/attendance-points';
import type { ActorClient } from '@/server/db/client';
import * as f from './attendance-points-fixtures';
function fixture(data: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    rpc,
    port: createAttendancePointsPort({ rpc } as unknown as ActorClient),
  };
}
it('snapshot calls only the identity-bound read RPC', async () => {
  const p = fixture(f.pointSnapshot);
  expect(await p.port.snapshot(null)).toEqual({
    ok: true,
    data: f.pointSnapshot,
  });
  expect(p.rpc).toHaveBeenCalledExactlyOnceWith('point_ui_snapshot', {
    p_limit: ATTENDANCE_POINTS.pageSize,
  });
});
it('forwards cursor precision without caller identity, balance or clock', async () => {
  const p = fixture(f.pointSnapshot);
  await p.port.snapshot({ id: f.pointEntry.id, created_at: f.pointsTime });
  expect(p.rpc).toHaveBeenCalledExactlyOnceWith('point_ui_snapshot', {
    p_limit: ATTENDANCE_POINTS.pageSize,
    p_before_created_at: f.pointsTime,
    p_before_id: f.pointEntry.id,
  });
});
it('attendance only forwards immutable operation identity', async () => {
  const p = fixture(f.attendanceReceipt);
  expect(await p.port.attend(f.attendanceInput)).toEqual({
    ok: true,
    data: f.attendanceReceipt,
  });
  expect(p.rpc).toHaveBeenCalledExactlyOnceWith('point_ui_check_attendance', {
    p_operation_id: f.attendanceInput.operation_id,
  });
});
for (const method of ['snapshot', 'attend'] as const) {
  it.each([null, {}, { raw: 'private' }])(
    `${method} rejects malformed RPC output %#`,
    async (data) => {
      const p = fixture(data);
      const result =
        method === 'snapshot'
          ? await p.port.snapshot(null)
          : await p.port.attend(f.attendanceInput);
      expect(result).toEqual({ ok: false, code: 'UNAVAILABLE' });
    },
  );
  it.each([
    ['COMMUNITY_FORBIDDEN', 'FORBIDDEN'],
    ['POINT_ACTOR_REQUIRED', 'FORBIDDEN'],
    ['POINT_POLICY_UNCONFIGURED', 'SETUP_NOT_READY'],
    ['POINT_PAGE_INVALID', 'INVALID_INPUT'],
    ['POINT_INVALID_INPUT', 'INVALID_INPUT'],
    ['POINT_OPERATION_REQUIRED', 'INVALID_INPUT'],
    ['POINT_IDEMPOTENCY_CONFLICT', 'CONFLICT'],
    ['POINT_BALANCE_OUT_OF_RANGE', 'BALANCE_LIMIT'],
    ['BOARD_ISOLATION_UNSUPPORTED', 'UNAVAILABLE'],
    ['unknown private SQL', 'UNAVAILABLE'],
    ['__proto__', 'UNAVAILABLE'],
  ])(`${method} maps exact safe %s to %s`, async (message, code) => {
    const p = fixture(null, { message });
    const result =
      method === 'snapshot'
        ? await p.port.snapshot(null)
        : await p.port.attend(f.attendanceInput);
    expect(result).toEqual({ ok: false, code });
  });
}
