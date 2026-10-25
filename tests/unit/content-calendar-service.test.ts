import { expect, it, vi } from 'vitest';
import {
  CONTENT_CALENDAR,
  contentCalendarInputSchema,
  contentCalendarEntrySchema,
} from '@/config/content-calendar';
import {
  resolveContentCalendarMonth,
  readArtistContentCalendar,
  readAdminContentCalendar,
} from '@/server/services/content-calendar/read';
import {
  saveContentCalendar,
  deleteContentCalendar,
} from '@/server/services/content-calendar/manage';
import {
  artistCalendar,
  adminCalendar,
  calendarArtistId,
  calendarEntry,
  calendarEntryId,
  calendarOtherId,
  calendarOperationId,
  calendarSave,
} from './content-calendar-fixtures';
function port() {
  return {
    artist: vi.fn().mockResolvedValue({ ok: true, data: artistCalendar }),
    admin: vi.fn().mockResolvedValue({ ok: true, data: adminCalendar }),
    save: vi.fn().mockResolvedValue({ ok: true, data: calendarEntry }),
    delete: vi.fn().mockResolvedValue({
      ok: true,
      data: { id: calendarEntryId, deleted: true },
    }),
  };
}
const artistQuery = {
  slug: artistCalendar.artist.slug,
  month: artistCalendar.month,
};
const adminQuery = { artist_id: calendarArtistId, month: artistCalendar.month };
const deletion = {
  operation_id: calendarOperationId,
  entry_id: calendarEntryId,
  expected_revision: 1,
  confirmed: true,
};
it('resolves omitted month at the Seoul civil-month boundary, without a policy default', () => {
  expect(
    resolveContentCalendarMonth({}, new Date('2026-10-31T14:59:59Z')),
  ).toEqual({ ok: true, data: '2026-10' });
  expect(
    resolveContentCalendarMonth({}, new Date('2026-10-31T15:00:00Z')),
  ).toEqual({ ok: true, data: '2026-11' });
  expect(resolveContentCalendarMonth({ month: '0001-01' })).toEqual({
    ok: true,
    data: '0001-01',
  });
  expect(resolveContentCalendarMonth({ month: '9999-12' })).toEqual({
    ok: true,
    data: '9999-12',
  });
});
it.each([
  null,
  [],
  '2026-10',
  { month: '' },
  { month: '0000-01' },
  { month: '2026-13' },
  { month: '2026-2' },
  { month: '2026-10-01' },
  { month: '10000-01' },
  { month: ['2026-10'] },
  { cursor: 'x' },
  { month: '2026-10', actor_id: calendarActor() },
])('rejects malformed month query %j', (input) =>
  expect(resolveContentCalendarMonth(input)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  }),
);
function calendarActor() {
  return calendarOtherId;
}
it('rejects invalid/out-of-domain clocks even with explicit month', () => {
  expect(resolveContentCalendarMonth({}, new Date(NaN)).ok).toBe(false);
  expect(
    resolveContentCalendarMonth({}, new Date('0000-01-01T00:00:00Z')).ok,
  ).toBe(false);
  expect(
    resolveContentCalendarMonth({ month: '2026-10' }, new Date(NaN)).ok,
  ).toBe(false);
});
it('reads the separate authorized artist/admin contexts with current-week metrics', async () => {
  const p = port();
  expect(await readArtistContentCalendar(p, artistQuery)).toEqual({
    ok: true,
    data: artistCalendar,
  });
  expect(await readAdminContentCalendar(p, adminQuery)).toEqual({
    ok: true,
    data: adminCalendar,
  });
  expect(p.artist).toHaveBeenCalledExactlyOnceWith(artistQuery);
  expect(p.admin).toHaveBeenCalledExactlyOnceWith(adminQuery);
  expect(
    (await readArtistContentCalendar(p, { ...artistQuery, month: '2026-09' }))
      .ok,
  ).toBe(false);
});
it.each([
  null,
  {},
  { ...artistQuery, slug: '../calendar' },
  { ...artistQuery, actor_id: calendarOtherId },
  { ...artistQuery, month: '2026-00' },
])('rejects invalid artist query before I/O %j', async (input) => {
  const p = port();
  expect(await readArtistContentCalendar(p, input)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(p.artist).not.toHaveBeenCalled();
});
it.each([
  null,
  {},
  { ...adminQuery, artist_id: 'bad' },
  { ...adminQuery, slug: 'other' },
  { ...adminQuery, month: '2026-00' },
])('rejects invalid admin query before I/O %j', async (input) => {
  const p = port();
  expect(await readAdminContentCalendar(p, input)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(p.admin).not.toHaveBeenCalled();
});
it.each([
  { ...artistCalendar, artist: { ...artistCalendar.artist, slug: 'wrong' } },
  { ...artistCalendar, month: '2026-11' },
  {
    ...artistCalendar,
    entries: [{ ...calendarEntry, artist_id: calendarOtherId }],
  },
  { ...artistCalendar, entries: [{ ...calendarEntry, date: '2026-11-01' }] },
  {
    ...artistCalendar,
    entries: [calendarEntry, { ...calendarEntry, id: calendarOtherId }],
  },
  {
    ...artistCalendar,
    entries: [calendarEntry, { ...calendarEntry, date: '2026-10-30' }],
  },
  {
    ...artistCalendar,
    entries: [
      calendarEntry,
      { ...calendarEntry, id: calendarOtherId, date: '2026-10-28' },
    ],
  },
  {
    ...artistCalendar,
    activity: { ...artistCalendar.activity, photoCount: 3 },
  },
  {
    ...artistCalendar,
    activity: { ...artistCalendar.activity, requirementsReady: true },
  },
  { ...artistCalendar, actor_id: calendarOtherId },
  {
    ...artistCalendar,
    entries: [{ ...calendarEntry, created_by: calendarOtherId }],
  },
])(
  'fails closed on mismatched/duplicate/private page result %#',
  async (data) => {
    const p = port();
    p.artist.mockResolvedValue({ ok: true, data });
    expect(await readArtistContentCalendar(p, artistQuery)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  },
);
it('rejects swapped administrator target and accepts empty calendars without synthetic topics', async () => {
  const p = port();
  p.admin.mockResolvedValue({
    ok: true,
    data: {
      ...adminCalendar,
      artist: { ...adminCalendar.artist, id: calendarOtherId },
    },
  });
  expect((await readAdminContentCalendar(p, adminQuery)).ok).toBe(false);
  p.artist.mockResolvedValue({
    ok: true,
    data: { ...artistCalendar, entries: [] },
  });
  expect(await readArtistContentCalendar(p, artistQuery)).toEqual({
    ok: true,
    data: { ...artistCalendar, entries: [] },
  });
});
it('normalizes new topic input while preserving optional example whitespace and name token', async () => {
  const p = port();
  expect(
    await saveContentCalendar(p, {
      ...calendarSave,
      input: { ...calendarSave.input, topic: ` ${calendarSave.input.topic} ` },
    }),
  ).toEqual({ ok: true, data: calendarEntry });
  expect(p.save).toHaveBeenCalledExactlyOnceWith(calendarSave);
  expect(calendarEntry.example_text).toContain('{이름}');
});
it('accepts Unicode code-point ceilings rather than rejecting astral characters at half the SQL limit', () => {
  for (const topic of [
    '가'.repeat(CONTENT_CALENDAR.topicMax),
    '🌟'.repeat(CONTENT_CALENDAR.topicMax),
  ])
    expect(
      contentCalendarInputSchema.safeParse({ ...calendarSave.input, topic })
        .success,
    ).toBe(true);
  expect(
    contentCalendarInputSchema.safeParse({
      ...calendarSave.input,
      topic: '🌟'.repeat(CONTENT_CALENDAR.topicMax + 1),
    }).success,
  ).toBe(false);
  expect(
    contentCalendarInputSchema.safeParse({
      ...calendarSave.input,
      example_text: '🌟'.repeat(CONTENT_CALENDAR.exampleMax),
    }).success,
  ).toBe(true);
  expect(
    contentCalendarInputSchema.safeParse({
      ...calendarSave.input,
      example_text: '🌟'.repeat(CONTENT_CALENDAR.exampleMax + 1),
    }).success,
  ).toBe(false);
});
it('does not retroactively rewrite legitimate legacy topic and example records', () => {
  const legacy = {
    ...calendarEntry,
    topic: ' 예전\n\t주제 ',
    example_text: '예전\u0001예문',
  };
  expect(contentCalendarEntrySchema.parse(legacy)).toEqual(legacy);
  expect(
    contentCalendarInputSchema.safeParse({
      ...calendarSave.input,
      topic: legacy.topic,
    }).success,
  ).toBe(false);
});
it.each([
  '0000-01-01',
  '2026-02-29',
  '2026-04-31',
  '2026-13-01',
  '2026-00-01',
  '2026-01-00',
  '2026-1-1',
  '10000-01-01',
  'infinity',
])('rejects unsupported editorial date %s', (date) =>
  expect(
    contentCalendarInputSchema.safeParse({ ...calendarSave.input, date })
      .success,
  ).toBe(false),
);
it.each(['0001-01-01', '9999-12-31', '2028-02-29'])(
  'accepts supported editorial date %s',
  (date) =>
    expect(
      contentCalendarInputSchema.safeParse({ ...calendarSave.input, date })
        .success,
    ).toBe(true),
);
it.each([
  '',
  ' ',
  '\n\t',
  'new\nline',
  'tab\tinside',
  'nul\u0000text',
  'del\u007ftext',
])('rejects unsafe or blank authored topic %j', (topic) =>
  expect(
    contentCalendarInputSchema.safeParse({ ...calendarSave.input, topic })
      .success,
  ).toBe(false),
);
it.each([
  null,
  '',
  ' ',
  'first\nsecond\r\n\tthird',
  '{이름}',
  '<script>alert(1)</script>',
])('preserves safe plain example content %j', (example_text) =>
  expect(
    contentCalendarInputSchema.parse({ ...calendarSave.input, example_text })
      .example_text,
  ).toBe(example_text),
);
it.each([
  'nul\u0000',
  'bell\u0007',
  'vertical\u000b',
  'form\u000c',
  'del\u007f',
])('rejects authored example controls %j', (example_text) =>
  expect(
    contentCalendarInputSchema.safeParse({
      ...calendarSave.input,
      example_text,
    }).success,
  ).toBe(false),
);
it.each([
  null,
  {},
  { ...calendarSave, operation_id: 'bad' },
  { ...calendarSave, entry_id: calendarEntryId },
  { ...calendarSave, expected_revision: 1 },
  { ...calendarSave, entry_id: calendarEntryId, expected_revision: 0 },
  {
    ...calendarSave,
    entry_id: calendarEntryId,
    expected_revision: Number.MAX_SAFE_INTEGER + 1,
  },
  { ...calendarSave, actor_id: calendarOtherId },
  {
    ...calendarSave,
    input: { ...calendarSave.input, created_by: calendarOtherId },
  },
])('rejects malformed saves before database invocation %#', async (input) => {
  const p = port();
  expect(await saveContentCalendar(p, input)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(p.save).not.toHaveBeenCalled();
});
it('update receipts accept unchanged no-op and one-step revision, never unexpected revisions', async () => {
  const p = port();
  const input = {
    ...calendarSave,
    entry_id: calendarEntryId,
    expected_revision: 1,
  };
  expect((await saveContentCalendar(p, input)).ok).toBe(true);
  p.save.mockResolvedValue({
    ok: true,
    data: { ...calendarEntry, revision: 2 },
  });
  expect((await saveContentCalendar(p, input)).ok).toBe(true);
  p.save.mockResolvedValue({
    ok: true,
    data: { ...calendarEntry, revision: 3 },
  });
  expect(await saveContentCalendar(p, input)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it.each([
  { ...calendarEntry, artist_id: calendarOtherId },
  { ...calendarEntry, date: '2026-10-30' },
  { ...calendarEntry, topic: 'wrong' },
  { ...calendarEntry, example_text: null },
  { ...calendarEntry, revision: 2 },
  { ...calendarEntry, created_by: calendarOtherId },
  null,
])(
  'fails closed instead of claiming wrong save intent success %#',
  async (data) => {
    const p = port();
    p.save.mockResolvedValue({ ok: true, data });
    expect(await saveContentCalendar(p, calendarSave)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  },
);
it('update cannot return another entry even if every authored value matches', async () => {
  const p = port();
  p.save.mockResolvedValue({
    ok: true,
    data: { ...calendarEntry, id: calendarOtherId },
  });
  expect(
    (
      await saveContentCalendar(p, {
        ...calendarSave,
        entry_id: calendarEntryId,
        expected_revision: 1,
      })
    ).ok,
  ).toBe(false);
});
it('confirmed delete binds response identity and never invents a success receipt', async () => {
  const p = port();
  expect(await deleteContentCalendar(p, deletion)).toEqual({
    ok: true,
    data: { id: calendarEntryId, deleted: true },
  });
  expect(p.delete).toHaveBeenCalledExactlyOnceWith(deletion);
  for (const data of [
    null,
    { id: calendarOtherId, deleted: true },
    { id: calendarEntryId, deleted: false },
    { id: calendarEntryId, deleted: true, topic: 'secret' },
  ]) {
    p.delete.mockResolvedValue({ ok: true, data });
    expect(await deleteContentCalendar(p, deletion)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  }
});
it.each([
  null,
  {},
  { ...deletion, confirmed: false },
  { ...deletion, expected_revision: null },
  { ...deletion, expected_revision: 0 },
  { ...deletion, actor_id: calendarOtherId },
  { ...deletion, entry_id: 'bad' },
])(
  'rejects unconfirmed or invalid deletion before database %#',
  async (input) => {
    const p = port();
    expect((await deleteContentCalendar(p, input)).ok).toBe(false);
    expect(p.delete).not.toHaveBeenCalled();
  },
);
it.each([
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'DATE_CONFLICT',
  'ARTIST_UNAVAILABLE',
  'UNAVAILABLE',
])(
  'preserves explicit failure %s across read and write services',
  async (code) => {
    const p = port();
    for (const fn of Object.values(p))
      fn.mockResolvedValue({ ok: false, code });
    expect(await readArtistContentCalendar(p, artistQuery)).toEqual({
      ok: false,
      code,
    });
    expect(await readAdminContentCalendar(p, adminQuery)).toEqual({
      ok: false,
      code,
    });
    expect(await saveContentCalendar(p, calendarSave)).toEqual({
      ok: false,
      code,
    });
    expect(await deleteContentCalendar(p, deletion)).toEqual({
      ok: false,
      code,
    });
  },
);
it('converts thrown database errors to unavailable without forwarding private exception text', async () => {
  const p = port();
  for (const fn of Object.values(p))
    fn.mockRejectedValue(new Error('private calendar text'));
  for (const result of await Promise.all([
    readArtistContentCalendar(p, artistQuery),
    readAdminContentCalendar(p, adminQuery),
    saveContentCalendar(p, calendarSave),
    deleteContentCalendar(p, deletion),
  ]))
    expect(result).toEqual({ ok: false, code: 'UNAVAILABLE' });
});

it.each(['\u0085', '\u009f', '\ud800', '\udfff'])(
  'rejects Unicode controls and malformed surrogate input %j before SQL JSON decoding',
  (character) => {
    expect(
      contentCalendarInputSchema.safeParse({
        ...calendarSave.input,
        topic: `prefix${character}suffix`,
      }).success,
    ).toBe(false);
    expect(
      contentCalendarInputSchema.safeParse({
        ...calendarSave.input,
        example_text: `prefix${character}suffix`,
      }).success,
    ).toBe(false);
  },
);
it('refuses overflowing save revision while retaining maximum safe delete/read support', async () => {
  const p = port();
  expect(
    await saveContentCalendar(p, {
      ...calendarSave,
      entry_id: calendarEntryId,
      expected_revision: Number.MAX_SAFE_INTEGER,
    }),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(p.save).not.toHaveBeenCalled();
  expect(
    (
      await deleteContentCalendar(p, {
        ...deletion,
        expected_revision: Number.MAX_SAFE_INTEGER,
      })
    ).ok,
  ).toBe(true);
  expect(
    contentCalendarEntrySchema.safeParse({
      ...calendarEntry,
      revision: Number.MAX_SAFE_INTEGER,
    }).success,
  ).toBe(true);
});

it('preserves locale-dependent legacy whitespace rather than imposing JS Unicode rules on old SQL records', () => {
  const legacy = { ...calendarEntry, topic: '\u00a0' };
  expect(contentCalendarEntrySchema.parse(legacy).topic).toBe('\u00a0');
  expect(
    contentCalendarInputSchema.safeParse({
      ...calendarSave.input,
      topic: '\u00a0',
    }).success,
  ).toBe(false);
});
