// @vitest-environment node
import { expect, it, vi } from 'vitest';
import {
  ATTENDANCE_POINTS,
  POINTS_ERROR_STATUS,
  pointSnapshotSchema,
  pointCursorSchema,
  pointEntrySchema,
  attendanceInputSchema,
  attendanceReceiptSchema,
  pointBefore,
  pointSameInstant,
} from '@/config/attendance-points';
import {
  getPointSnapshot,
  recordAttendance,
  resolvePointCursor,
} from '@/server/services/attendance-points/manage';
import * as f from './attendance-points-fixtures';
const ok = (data: unknown) => ({ ok: true, data });
function port() {
  return {
    snapshot: vi.fn().mockResolvedValue(ok(f.pointSnapshot)),
    attend: vi.fn().mockResolvedValue(ok(f.attendanceReceipt)),
  };
}
it('reads only the current actor snapshot', async () => {
  const p = port();
  expect(await getPointSnapshot(p, null, f.pointsActor)).toEqual(
    ok(f.pointSnapshot),
  );
  expect(p.snapshot).toHaveBeenCalledExactlyOnceWith(null);
});
it('preserves the operation ID without inventing day, amount or rewards', async () => {
  const p = port();
  expect(await recordAttendance(p, f.attendanceInput, f.pointsActor)).toEqual(
    ok(f.attendanceReceipt),
  );
  expect(p.attend).toHaveBeenCalledExactlyOnceWith(f.attendanceInput);
});
it('permits old immutable receipts without comparing them to the browser clock', async () => {
  const p = port(),
    receipt = { ...f.attendanceReceipt, earned_on: '2020-01-01' };
  p.attend.mockResolvedValue(ok(receipt));
  expect(await recordAttendance(p, f.attendanceInput, f.pointsActor)).toEqual(
    ok(receipt),
  );
});
it.each([
  undefined,
  null,
  {},
  { operation_id: 'bad' },
  { ...f.attendanceInput, amount: 99 },
  { ...f.attendanceInput, earned_on: '2026-01-01' },
  { ...f.attendanceInput, user_id: f.pointsOther },
])('rejects malformed write %# before IO', async (input) => {
  const p = port();
  expect(await recordAttendance(p, input, f.pointsActor)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(p.attend).not.toHaveBeenCalled();
});
it.each([
  undefined,
  {},
  { id: f.pointEntry.id },
  { created_at: f.pointsTime },
  { id: 'bad', created_at: f.pointsTime },
  { id: f.pointEntry.id, created_at: 'infinity' },
  { id: f.pointEntry.id, created_at: f.pointsTime, private: true },
])('rejects malformed cursor %# before IO', async (input) => {
  const p = port();
  expect(await getPointSnapshot(p, input, f.pointsActor)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(p.snapshot).not.toHaveBeenCalled();
});
for (const [method, call, input, output] of [
  ['snapshot', getPointSnapshot, null, f.pointSnapshot],
  ['attend', recordAttendance, f.attendanceInput, f.attendanceReceipt],
] as const) {
  it.each(['', 'bad'])('%s rejects invalid actor %#', async (actor) => {
    const p = port();
    expect(await call(p, input, actor)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(p[method]).not.toHaveBeenCalled();
  });
  it(`${method} rejects another actor`, async () => {
    const p = port();
    p[method].mockResolvedValue(ok({ ...output, actor_id: f.pointsOther }));
    expect(await call(p, input, f.pointsActor)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it.each([null, {}, { ...output, private: true }])(
    `${method} rejects malformed output %#`,
    async (data) => {
      const p = port();
      p[method].mockResolvedValue(ok(data));
      expect(await call(p, input, f.pointsActor)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
  it.each(Object.keys(POINTS_ERROR_STATUS))(
    `${method} preserves safe business error %s`,
    async (code) => {
      const p = port();
      p[method].mockResolvedValue({ ok: false, code });
      expect(await call(p, input, f.pointsActor)).toEqual({ ok: false, code });
    },
  );
  it(`${method} conceals thrown private failures`, async () => {
    const p = port();
    p[method].mockRejectedValue(new Error('private SQL detail'));
    expect(await call(p, input, f.pointsActor)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
}
it('rejects another operation receipt', async () => {
  const p = port();
  p.attend.mockResolvedValue(
    ok({ ...f.attendanceReceipt, operation_id: f.pointsOther }),
  );
  expect(await recordAttendance(p, f.attendanceInput, f.pointsActor)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('retains timestamp microseconds and applies strict descending cursor bounds', async () => {
  const p = port(),
    cursor = { id: f.pointEntry.id, created_at: '2026-10-26T06:00:00.123457Z' };
  expect(await getPointSnapshot(p, cursor, f.pointsActor)).toEqual(
    ok(f.pointSnapshot),
  );
  expect(p.snapshot).toHaveBeenCalledExactlyOnceWith(cursor);
  expect(
    await getPointSnapshot(
      p,
      { ...cursor, created_at: f.pointsTime },
      f.pointsActor,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('compares equivalent offsets and microseconds without millisecond collapse', () => {
  expect(
    pointSameInstant(f.pointsTime, '2026-10-26T15:00:00.123456+09:00'),
  ).toBe(true);
  expect(
    pointBefore(f.pointEntry, {
      ...f.pointEntry,
      created_at: '2026-10-26T06:00:00.123457Z',
    }),
  ).toBe(true);
  expect(
    pointBefore(f.pointEntry, { ...f.pointEntry, id: f.pointsOther }),
  ).toBe(false);
  expect(
    pointBefore({ ...f.pointEntry, id: f.pointsOther }, f.pointEntry),
  ).toBe(true);
});
it('accepts an unconfigured empty snapshot without making up rewards', () => {
  expect(
    pointSnapshotSchema.safeParse({
      ...f.pointSnapshot,
      attendance_amount: null,
      attendance_entry_id: null,
      entries: [],
      balance: 0,
    }).success,
  ).toBe(true);
});
it('accepts a disabled policy after completed attendance and zero-value attendance', () => {
  expect(
    pointSnapshotSchema.safeParse({
      ...f.pointSnapshot,
      attendance_amount: null,
    }).success,
  ).toBe(true);
  expect(
    pointSnapshotSchema.safeParse({
      ...f.pointSnapshot,
      attendance_amount: 0,
      balance: 0,
      entries: [{ ...f.pointEntry, amount: 0 }],
    }).success,
  ).toBe(true);
});
it.each([
  { balance: -1 },
  { balance: Number.MAX_SAFE_INTEGER + 1 },
  { balance: 1.5 },
  { attendance_amount: -1 },
  { attendance_amount: Number.MAX_SAFE_INTEGER + 1 },
  { kst_date: '0000-01-01' },
  { kst_date: '2026-02-30' },
  { kst_date: '2026-10-26T00:00:00Z' },
  { entries: [f.pointEntry, f.pointEntry] },
  { attendance_entry_id: null },
  { entries: [{ ...f.pointEntry, reason: 'admin_adjust' }] },
  { entries: [{ ...f.pointEntry, earned_on: '2026-10-25' }] },
  { entries: [{ ...f.pointEntry, amount: -10 }] },
  { entries: [{ ...f.pointEntry, policy_snapshot: { private: true } }] },
  {
    entries: [{ ...f.pointEntry, created_at: '2026-10-26T06:00:00.1234567Z' }],
  },
  { entries: [{ ...f.pointEntry, created_at: '0000-01-01T00:00:00Z' }] },
  { next_cursor: { id: f.pointEntry.id, created_at: f.pointsTime } },
])('rejects incoherent private snapshot %#', (extra) =>
  expect(
    pointSnapshotSchema.safeParse({ ...f.pointSnapshot, ...extra }).success,
  ).toBe(false),
);
it('validates all supported reasons and signed correction bounds', () => {
  for (const reason of ['attendance', 'post', 'comment'])
    expect(
      pointEntrySchema.safeParse({ ...f.pointEntry, reason }).success,
    ).toBe(true);
  expect(
    pointEntrySchema.safeParse({
      ...f.pointEntry,
      reason: 'admin_adjust',
      amount: -10,
    }).success,
  ).toBe(true);
  expect(
    pointEntrySchema.safeParse({
      ...f.pointEntry,
      reason: 'admin_adjust',
      amount: 0,
    }).success,
  ).toBe(false);
  expect(
    pointEntrySchema.safeParse({ ...f.pointEntry, reason: 'share' }).success,
  ).toBe(false);
});
it('requires exact full-page cursor matching, uniqueness and ordering', () => {
  const page = f.pointPage();
  expect(pointSnapshotSchema.safeParse(page).success).toBe(true);
  expect(
    pointSnapshotSchema.safeParse({
      ...page,
      entries: [...page.entries].reverse(),
    }).success,
  ).toBe(false);
  expect(
    pointSnapshotSchema.safeParse({
      ...page,
      next_cursor: { ...page.next_cursor!, id: f.pointsOther },
    }).success,
  ).toBe(false);
  expect(
    pointSnapshotSchema.safeParse({
      ...page,
      entries: [...page.entries, f.pointEntry],
    }).success,
  ).toBe(false);
  expect(
    pointSnapshotSchema.safeParse({
      ...page,
      next_cursor: {
        ...page.next_cursor!,
        created_at: '2026-10-26T15:00:00.123456+09:00',
      },
    }).success,
  ).toBe(true);
});
it.each([
  {},
  { cursor: JSON.stringify({ id: f.pointEntry.id, created_at: f.pointsTime }) },
])('resolves encoded cursor %#', (input) =>
  expect(resolvePointCursor(input).ok).toBe(true),
);
it.each([
  null,
  undefined,
  { cursor: '' },
  { cursor: 'null' },
  { cursor: '{' },
  { cursor: '[]' },
  { cursor: 'x'.repeat(ATTENDANCE_POINTS.cursorMax + 1) },
  { cursor: 5 },
  { limit: 100 },
  { cursor: JSON.stringify({ ...f.pointEntry, private: true }) },
])('rejects malformed query %#', (input) => {
  // The literal null cursor is harmless and identical to an omitted initial-page cursor.
  expect(resolvePointCursor(input).ok).toBe(
    typeof input === 'object' &&
      input !== null &&
      'cursor' in input &&
      input.cursor === 'null',
  );
});
it.each([
  null,
  {},
  { ...f.attendanceReceipt, amount: -1 },
  { ...f.attendanceReceipt, amount: Number.MAX_SAFE_INTEGER + 1 },
  { ...f.attendanceReceipt, earned_on: '2026-02-30' },
  { ...f.attendanceReceipt, private: true },
])('rejects malformed attendance receipt %#', (input) =>
  expect(attendanceReceiptSchema.safeParse(input).success).toBe(false),
);
it('normalizes UUID case without losing operation intent', () => {
  const uppercase = 'ABCDEF12-0000-4000-8000-000000000001';
  expect(attendanceInputSchema.parse({ operation_id: uppercase })).toEqual({
    operation_id: uppercase.toLowerCase(),
  });
  expect(
    pointCursorSchema.parse({ id: uppercase, created_at: f.pointsTime }).id,
  ).toBe(uppercase.toLowerCase());
});
