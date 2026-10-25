// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createContentCalendarPort } from '@/server/db/content-calendar';
import type { ActorClient } from '@/server/db/client';
import {
  artistCalendar,
  adminCalendar,
  calendarArtistId,
  calendarEntry,
  calendarEntryId,
  calendarOperationId,
  calendarSave,
  calendarWire,
  calendarOtherId,
} from './content-calendar-fixtures';
function fixture(data: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    port: createContentCalendarPort({ rpc } as unknown as ActorClient),
    rpc,
  };
}
const artistQuery = {
  slug: artistCalendar.artist.slug,
  month: artistCalendar.month,
};
const adminQuery = { artist_id: calendarArtistId, month: artistCalendar.month };
it('artist context uses membership-bound slug and exact calendar month without actor arguments', async () => {
  const f = fixture(calendarWire());
  expect(await f.port.artist(artistQuery)).toEqual({
    ok: true,
    data: artistCalendar,
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith(
    'content_calendar_artist_context',
    { p_artist_slug: artistQuery.slug, p_month: '2026-10-01' },
  );
});
it('admin list uses UUID and returns status/current-week metrics with no fan data', async () => {
  const f = fixture(calendarWire(true));
  expect(await f.port.admin(adminQuery)).toEqual({
    ok: true,
    data: adminCalendar,
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('content_calendar_admin_list', {
    p_artist_id: calendarArtistId,
    p_month: '2026-10-01',
  });
});
it.each([
  '2026-10',
  '2026-10-02',
  '2026-10-01junk',
  '2026-10-01T00:00:00Z',
  '0000-10-01',
  '2026-02-29',
  null,
])('does not silently truncate malformed wire month %j', async (month) =>
  expect(
    await fixture({ ...calendarWire(), month }).port.artist(artistQuery),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' }),
);
it.each([
  'id',
  'actor_id',
  'replies',
  'selected_message',
  'email',
  'created_by',
])('rejects unapproved top-level projection %s', async (key) =>
  expect(
    (
      await fixture({ ...calendarWire(), [key]: calendarOtherId }).port.artist(
        artistQuery,
      )
    ).ok,
  ).toBe(false),
);
it.each(['created_by', 'user_id', 'contact', 'secret'])(
  'rejects unexpected editorial field %s',
  async (key) =>
    expect(
      (
        await fixture({
          ...calendarWire(),
          entries: [{ ...calendarEntry, [key]: calendarOtherId }],
        }).port.artist(artistQuery)
      ).ok,
    ).toBe(false),
);
it.each(['grade', 'email', 'agency_name', 'role'])(
  'rejects unexpected artist field %s',
  async (key) =>
    expect(
      (
        await fixture({
          ...calendarWire(),
          artist: { ...artistCalendar.artist, [key]: 'private' },
        }).port.artist(artistQuery)
      ).ok,
    ).toBe(false),
);
it.each([
  { ...calendarWire(), artist: { ...artistCalendar.artist, status: 'active' } },
  { ...calendarWire(), server_now: 'invalid' },
  {
    ...calendarWire(),
    activity: { ...calendarWire().activity, requirements_ready: true },
  },
  {
    ...calendarWire(),
    activity: { ...calendarWire().activity, weekly_message_min: 3 },
  },
  {
    ...calendarWire(),
    activity: { ...calendarWire().activity, photo_count: 3 },
  },
  { ...calendarWire(), activity: { ...calendarWire().activity, user_ids: [] } },
  { ...calendarWire(), entries: [{ ...calendarEntry, revision: 0 }] },
  { ...calendarWire(), entries: [{ ...calendarEntry, topic: '' }] },
  { ...calendarWire(), entries: [{ ...calendarEntry, date: '2026-02-29' }] },
  { ...calendarWire(), entries: Array(32).fill(calendarEntry) },
  null,
  [],
  {},
])('rejects malformed or unexpected wire DTO %#', async (data) =>
  expect(await fixture(data).port.artist(artistQuery)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  }),
);
it('admin status is required and validated, while no-op legacy contents are preserved exactly', async () => {
  expect((await fixture(calendarWire()).port.admin(adminQuery)).ok).toBe(false);
  expect(
    (
      await fixture({
        ...calendarWire(true),
        artist: { ...adminCalendar.artist, status: 'unknown' },
      }).port.admin(adminQuery)
    ).ok,
  ).toBe(false);
  const legacy = {
    ...calendarEntry,
    topic: ' 예전\n\t주제 ',
    example_text: '원문\u0001',
  };
  const result = await fixture({
    ...calendarWire(),
    entries: [legacy],
  }).port.artist(artistQuery);
  expect(result.ok && result.data.entries[0]).toEqual(legacy);
});
it('create omits nullable identity/revision fields and passes normalized exact write intent', async () => {
  const f = fixture(calendarEntry);
  expect(await f.port.save(calendarSave)).toEqual({
    ok: true,
    data: calendarEntry,
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('content_calendar_admin_save', {
    p_operation_id: calendarOperationId,
    p_input: calendarSave.input,
  });
});
it('update preserves operation identifier and expected revision', async () => {
  const f = fixture({ ...calendarEntry, revision: 2 });
  await f.port.save({
    ...calendarSave,
    entry_id: calendarEntryId,
    expected_revision: 1,
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('content_calendar_admin_save', {
    p_operation_id: calendarOperationId,
    p_entry_id: calendarEntryId,
    p_expected_revision: 1,
    p_input: calendarSave.input,
  });
});
it('delete passes explicit confirmation and validates the minimal receipt', async () => {
  const f = fixture({ id: calendarEntryId, deleted: true });
  const input = {
    operation_id: calendarOperationId,
    entry_id: calendarEntryId,
    expected_revision: 1,
    confirmed: true as const,
  };
  expect(await f.port.delete(input)).toEqual({
    ok: true,
    data: { id: calendarEntryId, deleted: true },
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith(
    'content_calendar_admin_delete',
    {
      p_operation_id: calendarOperationId,
      p_entry_id: calendarEntryId,
      p_expected_revision: 1,
      p_confirmed: true,
    },
  );
  for (const data of [
    null,
    {},
    { id: calendarEntryId, deleted: false },
    { id: calendarEntryId, deleted: true, actor_id: calendarOtherId },
  ])
    expect((await fixture(data).port.delete(input)).ok).toBe(false);
});
it.each([
  ['CONTENT_CALENDAR_INVALID_INPUT', 'INVALID_INPUT'],
  ['CONTENT_CALENDAR_REVISION_CONFLICT', 'CONFLICT'],
  ['CONTENT_CALENDAR_OPERATION_CONFLICT', 'CONFLICT'],
  ['CONTENT_CALENDAR_DATE_CONFLICT', 'DATE_CONFLICT'],
  ['CONTENT_CALENDAR_ENTRY_UNAVAILABLE', 'NOT_FOUND'],
  ['CONTENT_CALENDAR_CONFIRMATION_REQUIRED', 'CONFIRMATION_REQUIRED'],
  ['CALENDAR_FORBIDDEN', 'FORBIDDEN'],
  ['CALENDAR_ARTIST_UNAVAILABLE', 'ARTIST_UNAVAILABLE'],
  ['CALENDAR_INVALID_MONTH', 'INVALID_INPUT'],
  ['ARTIST_REPLY_FORBIDDEN', 'FORBIDDEN'],
  ['ARTIST_REPLY_NOT_FOUND', 'NOT_FOUND'],
  ['ARTIST_REPLY_INVALID_INPUT', 'INVALID_INPUT'],
  ['ARTIST_REPLY_ISOLATION_UNSUPPORTED', 'UNAVAILABLE'],
  ['SCHEDULE_ISOLATION_UNSUPPORTED', 'UNAVAILABLE'],
  ['database failed with private data', 'UNAVAILABLE'],
  ['toString', 'UNAVAILABLE'],
  ['constructor', 'UNAVAILABLE'],
])(
  'maps exact DB error %s without exposing raw text',
  async (message, code) => {
    const f = fixture(calendarWire(), { message });
    expect(await f.port.artist(artistQuery)).toEqual({ ok: false, code });
    expect(await f.port.admin(adminQuery)).toEqual({ ok: false, code });
    expect(await f.port.save(calendarSave)).toEqual({ ok: false, code });
    expect(
      await f.port.delete({
        operation_id: calendarOperationId,
        entry_id: calendarEntryId,
        expected_revision: 1,
        confirmed: true,
      }),
    ).toEqual({ ok: false, code });
  },
);
