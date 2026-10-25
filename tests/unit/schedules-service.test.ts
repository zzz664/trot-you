// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { SCHEDULES } from '@/config/schedules';
import {
  resolveScheduleQuery,
  resolveAdminScheduleQuery,
  encodeScheduleCursor,
  decodeScheduleCursor,
  listSchedules,
  getSchedule,
  listAdminSchedules,
  getAdminSchedule,
  type ScheduleReadPort,
} from '@/server/services/schedules/read';
import {
  saveAdminSchedule,
  deleteAdminSchedule,
  type ScheduleWritePort,
} from '@/server/services/schedules/manage';
import {
  scheduleEvent,
  adminSchedule,
  scheduleId,
  scheduleArtist,
  scheduleSave,
  scheduleOperation,
} from './schedules-fixtures';
function port() {
  return {
    list: vi.fn().mockResolvedValue({ ok: true, data: [scheduleEvent] }),
    myArtists: vi.fn().mockResolvedValue({ ok: true, data: [scheduleArtist] }),
    detail: vi.fn().mockResolvedValue({ ok: true, data: scheduleEvent }),
    adminList: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        month: '2026-10',
        page: 1,
        page_size: 30,
        has_more: false,
        items: [adminSchedule],
      },
    }),
    adminDetail: vi.fn().mockResolvedValue({ ok: true, data: adminSchedule }),
    save: vi.fn().mockResolvedValue({ ok: true, data: adminSchedule }),
    delete: vi
      .fn()
      .mockResolvedValue({ ok: true, data: { id: scheduleId, deleted: true } }),
  } satisfies ScheduleReadPort & ScheduleWritePort;
}
it('defaults current month in Korea, including UTC month boundary', () => {
  expect(resolveScheduleQuery({}, new Date('2026-10-31T15:00:00Z'))).toEqual({
    ok: true,
    data: { month: '2026-11', cursor: null },
  });
  expect(
    resolveAdminScheduleQuery({}, new Date('2026-10-31T14:59:59Z')),
  ).toEqual({ ok: true, data: { month: '2026-10', page: 1 } });
});
it.each([
  null,
  [],
  { month: ['2026-10'] },
  { month: '0000-01' },
  { month: '10000-01' },
  { month: '2026-00' },
  { month: '2026-13' },
  { month: '2026-1' },
  { month: '2026-10-01' },
  { month: ' 2026-10' },
  { artist_id: scheduleArtist },
  { cursor: '' },
  { cursor: 'x'.repeat(513) },
])('rejects invalid fan query %#', (input) =>
  expect(resolveScheduleQuery(input)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  }),
);
it.each(['0', '-1', '1001', 'NaN', '1.1', '01', '1e2', '1 '.trimEnd() + ' '])(
  'rejects invalid admin page %s',
  (page) =>
    expect(resolveAdminScheduleQuery({ page })).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    }),
);
it.each([new Date(NaN), new Date(8640000000000000)])(
  'fails closed unsupported clocks %#',
  (now) => {
    expect(resolveScheduleQuery({}, now)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(resolveAdminScheduleQuery({}, now)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
  },
);
it('accepts full ISO month bounds without timezone guessing', () => {
  for (const month of ['0001-01', '0099-02', '9999-12'])
    expect(resolveScheduleQuery({ month })).toEqual({
      ok: true,
      data: { month, cursor: null },
    });
});
it('cursor is canonical, query-scoped and contains no identity', () => {
  const cursor = {
    month: '2026-10',
    starts_at: scheduleEvent.starts_at,
    id: scheduleId,
  };
  const encoded = encodeScheduleCursor(cursor);
  expect(decodeScheduleCursor(encoded, '2026-10')).toEqual({
    ok: true,
    data: cursor,
  });
  expect(decodeScheduleCursor(encoded, '2026-11')).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(decodeScheduleCursor(`${encoded}=`, cursor.month)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(
    decodeScheduleCursor(
      btoa(JSON.stringify({ ...cursor, user_id: scheduleArtist })),
      cursor.month,
    ),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(decodeScheduleCursor('not-json', cursor.month)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
});
it('reads only a bounded page and own current-access membership', async () => {
  const p = port();
  expect(await listSchedules(p, { month: '2026-10', cursor: null })).toEqual({
    ok: true,
    data: {
      month: '2026-10',
      items: [scheduleEvent],
      myArtistIds: [scheduleArtist],
      nextCursor: null,
    },
  });
  expect(p.list).toHaveBeenCalledExactlyOnceWith('2026-10', null);
  expect(p.myArtists).toHaveBeenCalledOnce();
});
it('full page exposes continuation rather than silently truncating calendar', async () => {
  const p = port();
  p.list.mockResolvedValue({
    ok: true,
    data: Array.from({ length: SCHEDULES.pageSize }, () => scheduleEvent),
  });
  const result = await listSchedules(p, { month: '2026-10', cursor: null });
  expect(result.ok && result.data.nextCursor).toBe(
    encodeScheduleCursor({
      month: '2026-10',
      starts_at: scheduleEvent.starts_at,
      id: scheduleId,
    }),
  );
});
it('does not call ports on invalid list/cursor or privileged input', async () => {
  const p = port();
  for (const input of [
    { month: 'bad', cursor: null },
    { month: '2026-10', cursor: 'bad' },
    { month: '2026-10', cursor: null, actor_id: scheduleId },
  ])
    expect(await listSchedules(p, input)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
  expect(p.list).not.toHaveBeenCalled();
  expect(p.myArtists).not.toHaveBeenCalled();
});
it.each(['list', 'myArtists'] as const)(
  'sanitizes %s failures and never falls back to fake data',
  async (method) => {
    const p = port();
    p[method].mockRejectedValue(new Error('private'));
    expect(await listSchedules(p, { month: '2026-10', cursor: null })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    p[method].mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    expect(await listSchedules(p, { month: '2026-10', cursor: null })).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
  },
);
it('validates detail IDs and propagates current data errors', async () => {
  const p = port();
  expect(await getSchedule(p, scheduleId)).toEqual({
    ok: true,
    data: scheduleEvent,
  });
  expect(await getAdminSchedule(p, scheduleId)).toEqual({
    ok: true,
    data: adminSchedule,
  });
  expect(await getSchedule(p, 'bad')).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(await getAdminSchedule(p, 'bad')).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  p.detail.mockRejectedValue(new Error('private'));
  p.adminDetail.mockRejectedValue(new Error('private'));
  expect(await getSchedule(p, scheduleId)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
  expect(await getAdminSchedule(p, scheduleId)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('validates admin list pages', async () => {
  const p = port();
  expect((await listAdminSchedules(p, { month: '2026-10', page: 1 })).ok).toBe(
    true,
  );
  expect(await listAdminSchedules(p, { month: '2026-10', page: 0 })).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  p.adminList.mockRejectedValue(new Error('private'));
  expect(await listAdminSchedules(p, { month: '2026-10', page: 1 })).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('draft save uses actor-bound RPC input without inventing authorization', async () => {
  const p = port();
  expect(await saveAdminSchedule(p, scheduleSave)).toEqual({
    ok: true,
    data: adminSchedule,
  });
  expect(p.save).toHaveBeenCalledExactlyOnceWith(scheduleSave);
});
it('publishing requires explicit confirmation before reaching database', async () => {
  const p = port();
  const input = {
    ...scheduleSave,
    input: { ...scheduleSave.input, status: 'published' },
  };
  expect(await saveAdminSchedule(p, input)).toEqual({
    ok: false,
    code: 'CONFIRMATION_REQUIRED',
  });
  expect(p.save).not.toHaveBeenCalled();
  expect((await saveAdminSchedule(p, { ...input, confirmed: true })).ok).toBe(
    true,
  );
});
it.each([
  { schedule_id: scheduleId },
  { expected_revision: 1 },
  { operation_id: 'bad' },
  { actor_id: scheduleId },
])('rejects malformed mutation identity %#', async (extra) => {
  const p = port();
  expect(await saveAdminSchedule(p, { ...scheduleSave, ...extra })).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(p.save).not.toHaveBeenCalled();
});
it.each([
  { title: ' ' },
  { title: 'x'.repeat(1001) },
  { lat: NaN },
  { lng: null },
  { ends_at: scheduleEvent.starts_at },
  { status: 'deleted' },
  { place_name: '' },
  { description: '\u0000' },
  { address: 'a\nb' },
])('rejects invalid event %#', async (extra) => {
  const p = port();
  expect(
    await saveAdminSchedule(p, {
      ...scheduleSave,
      input: { ...scheduleSave.input, ...extra },
    }),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(p.save).not.toHaveBeenCalled();
});
it('delete requires target revision and confirmation', async () => {
  const p = port();
  const input = {
    operation_id: scheduleOperation,
    schedule_id: scheduleId,
    expected_revision: 1,
    confirmed: true,
  };
  expect(await deleteAdminSchedule(p, input)).toEqual({
    ok: true,
    data: { id: scheduleId, deleted: true },
  });
  expect(await deleteAdminSchedule(p, { ...input, confirmed: false })).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(
    await deleteAdminSchedule(p, { ...input, expected_revision: 0 }),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
});
it('never reports mutation success on transport failure', async () => {
  const p = port();
  p.save.mockRejectedValue(new Error('private'));
  p.delete.mockRejectedValue(new Error('private'));
  expect(await saveAdminSchedule(p, scheduleSave)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
  expect(
    await deleteAdminSchedule(p, {
      operation_id: scheduleOperation,
      schedule_id: scheduleId,
      expected_revision: 1,
      confirmed: true,
    }),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});

it('default month follows historical Asia/Seoul rather than fixed UTC+09', () => {
  expect(resolveScheduleQuery({}, new Date('1899-12-31T15:10:00Z'))).toEqual({
    ok: true,
    data: { month: '1899-12', cursor: null },
  });
  expect(
    resolveAdminScheduleQuery({}, new Date('1988-06-30T14:30:00Z')),
  ).toEqual({ ok: true, data: { month: '1988-07', page: 1 } });
});
