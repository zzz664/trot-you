// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createSchedulePort } from '@/server/db/schedules';
import type { ActorClient } from '@/server/db/client';
import {
  scheduleEvent,
  adminSchedule,
  scheduleId,
  scheduleArtist,
  scheduleSave,
  scheduleOperation,
} from './schedules-fixtures';
function fixture(data: unknown, error: { message: string } | null = null) {
  const result = { data, error };
  const single = vi.fn().mockResolvedValue(result);
  const rpc = vi
    .fn()
    .mockReturnValue(Object.assign(Promise.resolve(result), { single }));
  return {
    port: createSchedulePort({ rpc } as unknown as ActorClient),
    rpc,
    single,
  };
}
it('list calls bounded safe catalog RPC without caller-controlled actor or SQL', async () => {
  const f = fixture([scheduleEvent]);
  expect(await f.port.list('2026-10', null)).toEqual({
    ok: true,
    data: [scheduleEvent],
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('schedule_list', {
    p_month: '2026-10-01',
    p_limit: 100,
  });
});
it('list forwards complete validated keyset cursor', async () => {
  const f = fixture([]);
  await f.port.list('2026-10', {
    month: '2026-10',
    id: scheduleId,
    starts_at: scheduleEvent.starts_at,
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('schedule_list', {
    p_month: '2026-10-01',
    p_limit: 100,
    p_after_id: scheduleId,
    p_after_starts_at: scheduleEvent.starts_at,
  });
});
it('private artist membership is actor scoped with no identity argument', async () => {
  const f = fixture([scheduleArtist]);
  expect(await f.port.myArtists()).toEqual({
    ok: true,
    data: [scheduleArtist],
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('schedule_my_artists');
});
it('detail projects an exact event identity', async () => {
  const f = fixture(scheduleEvent);
  expect(await f.port.detail(scheduleId)).toEqual({
    ok: true,
    data: scheduleEvent,
  });
  expect(f.single).toHaveBeenCalledOnce();
  expect(
    await fixture({ ...scheduleEvent, id: scheduleArtist }).port.detail(
      scheduleId,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('admin list normalizes SQL date to route month and rejects mismatched page', async () => {
  const data = {
    month: '2026-10-01',
    page: 1,
    page_size: 30,
    has_more: false,
    items: [adminSchedule],
  };
  const f = fixture(data);
  expect(await f.port.adminList({ month: '2026-10', page: 1 })).toEqual({
    ok: true,
    data: { ...data, month: '2026-10' },
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('schedule_admin_list', {
    p_month: '2026-10-01',
    p_page: 1,
  });
  expect(
    await fixture({ ...data, page: 2 }).port.adminList({
      month: '2026-10',
      page: 1,
    }),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(
    await fixture({ ...data, month: '2026-11-01' }).port.adminList({
      month: '2026-10',
      page: 1,
    }),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('admin detail cannot substitute another target', async () => {
  expect(await fixture(adminSchedule).port.adminDetail(scheduleId)).toEqual({
    ok: true,
    data: adminSchedule,
  });
  expect(
    await fixture({ ...adminSchedule, id: scheduleArtist }).port.adminDetail(
      scheduleId,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('create omits nullable identifiers rather than inventing UUID or expected revision', async () => {
  const f = fixture(adminSchedule);
  expect((await f.port.save(scheduleSave)).ok).toBe(true);
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('schedule_admin_save', {
    p_operation_id: scheduleOperation,
    p_input: scheduleSave.input,
    p_confirmed: false,
  });
});
it('update passes exact revision and persistent operation and rejects swapped target', async () => {
  const input = {
    ...scheduleSave,
    schedule_id: scheduleId,
    expected_revision: 1,
  };
  const f = fixture(adminSchedule);
  expect((await f.port.save(input)).ok).toBe(true);
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('schedule_admin_save', {
    p_operation_id: scheduleOperation,
    p_schedule_id: scheduleId,
    p_expected_revision: 1,
    p_input: input.input,
    p_confirmed: false,
  });
  expect(
    await fixture({ ...adminSchedule, id: scheduleArtist }).port.save(input),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('delete returns only matched receipt, not success for null or different target', async () => {
  const input = {
    operation_id: scheduleOperation,
    schedule_id: scheduleId,
    expected_revision: 1,
    confirmed: true as const,
  };
  const f = fixture({ id: scheduleId, deleted: true });
  expect(await f.port.delete(input)).toEqual({
    ok: true,
    data: { id: scheduleId, deleted: true },
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('schedule_admin_delete', {
    p_operation_id: scheduleOperation,
    p_schedule_id: scheduleId,
    p_expected_revision: 1,
    p_confirmed: true,
  });
  for (const data of [
    null,
    { id: scheduleArtist, deleted: true },
    { id: scheduleId, deleted: false },
  ])
    expect(await fixture(data).port.delete(input)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
});
it.each(['created_by', 'contact', 'user_id', 'secret'])(
  'rejects unexpected public projection field %s',
  async (field) => {
    expect(
      await fixture({ ...scheduleEvent, [field]: 'private' }).port.detail(
        scheduleId,
      ),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  },
);
it.each([
  null,
  {},
  [],
  { ...scheduleEvent, lat: null },
  { ...scheduleEvent, starts_at: 'infinity' },
  { ...scheduleEvent, type: 'invalid' },
])('fails closed malformed event %#', async (data) =>
  expect(await fixture(data).port.detail(scheduleId)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  }),
);
it.each([
  ['CALENDAR_FORBIDDEN', 'FORBIDDEN'],
  ['CALENDAR_ARTIST_UNAVAILABLE', 'ARTIST_UNAVAILABLE'],
  ['CALENDAR_INVALID_MONTH', 'INVALID_INPUT'],
  ['SCHEDULE_UNAVAILABLE', 'NOT_FOUND'],
  ['SCHEDULE_INVALID_INPUT', 'INVALID_INPUT'],
  ['SCHEDULE_CONFIRMATION_REQUIRED', 'CONFIRMATION_REQUIRED'],
  ['SCHEDULE_OPERATION_CONFLICT', 'CONFLICT'],
  ['SCHEDULE_REVISION_CONFLICT', 'CONFLICT'],
  ['SCHEDULE_ISOLATION_UNSUPPORTED', 'UNAVAILABLE'],
  ['private token', 'UNAVAILABLE'],
  ['__proto__', 'UNAVAILABLE'],
])('sanitizes exact database error %s', async (message, code) =>
  expect(await fixture(null, { message }).port.detail(scheduleId)).toEqual({
    ok: false,
    code,
  }),
);
