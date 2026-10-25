import { expect, it } from 'vitest';
import fixture from '../fixtures/schedule-timezone.json';
import {
  scheduleFromLocalDateTime,
  scheduleToLocalDateTime,
  scheduleLocalDayStart,
  scheduleMonthAt,
  scheduleMonthIntervals,
  scheduleDayKeys,
} from '@/lib/schedule-view';
it.each(fixture.forms)(
  'form $label chooses valid IANA instant or rejects missing/unsupported time',
  ({ date, time, utc }) => {
    expect(scheduleFromLocalDateTime(date, time)).toBe(utc);
  },
);
it.each(fixture.instants)(
  'instant $label displays actual Seoul civil time and month',
  ({ utc, date, time, month }) => {
    expect(scheduleToLocalDateTime(utc)).toEqual({ date, time });
    expect(scheduleMonthAt(new Date(utc))).toBe(month);
  },
);
it.each(fixture.dayStarts)(
  'civil midnight $date matches PostgreSQL normalization',
  ({ date, utc }) => {
    expect(new Date(scheduleLocalDayStart(date)).toISOString()).toBe(utc);
  },
);
it.each(fixture.months)(
  'month $month has exact matching database boundaries',
  ({ month, start, end }) => {
    const intervals = scheduleMonthIntervals(month);
    expect(new Date(intervals[0]!.start).toISOString()).toBe(start);
    expect(new Date(intervals.at(-1)!.end).toISOString()).toBe(end);
  },
);
it('uses23-hour/25-hour days and keeps events on the correct repeated or missing-clock day', () => {
  const spring = scheduleMonthIntervals('1988-05').find(
    ({ day }) => day === '1988-05-08',
  )!;
  const autumn = scheduleMonthIntervals('1988-10').find(
    ({ day }) => day === '1988-10-09',
  )!;
  expect(spring.end - spring.start).toBe(23 * 60 * 60 * 1000);
  expect(autumn.end - autumn.start).toBe(25 * 60 * 60 * 1000);
  expect(
    scheduleDayKeys(
      { starts_at: '1988-05-07T17:00:00Z', ends_at: null },
      '1988-05',
    ),
  ).toEqual(['1988-05-08']);
  expect(
    scheduleDayKeys(
      { starts_at: '1988-10-08T16:30:00Z', ends_at: '1988-10-08T17:30:00Z' },
      '1988-10',
    ),
  ).toEqual(['1988-10-09']);
  expect(
    scheduleDayKeys(
      { starts_at: '1899-12-31T15:32:08Z', ends_at: null },
      '1900-01',
    ),
  ).toEqual(['1900-01-01']);
  expect(
    scheduleDayKeys(
      { starts_at: '0001-01-01T00:32:08Z', ends_at: null },
      '0001-01',
    ),
  ).toEqual(['0001-01-01']);
  expect(
    scheduleDayKeys(
      { starts_at: '9999-12-31T14:59:00Z', ends_at: null },
      '9999-12',
    ),
  ).toEqual(['9999-12-31']);
});
it('rejects invalid calendar/instant inputs without normalization', () => {
  expect(scheduleMonthAt(new Date(NaN))).toBeNull();
  expect(scheduleMonthAt(new Date('10000-01-01T00:00:00Z'))).toBeNull();
  expect(scheduleLocalDayStart('2026-02-30')).toBeNaN();
  expect(scheduleMonthIntervals('0000-01')).toEqual([]);
});
it.each([
  {
    label: 'exclusive-month-end',
    month: '2026-10',
    starts_at: '2026-09-30T14:59:59.999999Z',
    ends_at: '2026-09-30T15:00:00.000000Z',
    expected: [],
  },
  {
    label: 'one-microsecond-into-month',
    month: '2026-10',
    starts_at: '2026-09-30T14:59:59.999999Z',
    ends_at: '2026-09-30T15:00:00.000001Z',
    expected: ['2026-10-01'],
  },
  {
    label: 'exclusive-day-end',
    month: '2026-10',
    starts_at: '2026-10-01T14:59:59.999999Z',
    ends_at: '2026-10-01T15:00:00.000000Z',
    expected: ['2026-10-01'],
  },
  {
    label: 'one-microsecond-into-day',
    month: '2026-10',
    starts_at: '2026-10-01T14:59:59.999999Z',
    ends_at: '2026-10-01T15:00:00.000001Z',
    expected: ['2026-10-01', '2026-10-02'],
  },
  {
    label: 'one-microsecond-duration',
    month: '2026-10',
    starts_at: '2026-10-01T15:00:00.000001Z',
    ends_at: '2026-10-01T15:00:00.000002Z',
    expected: ['2026-10-02'],
  },
  {
    label: 'negative-epoch-microsecond-duration',
    month: '1970-01',
    starts_at: '1969-12-31T23:59:59.999998Z',
    ends_at: '1969-12-31T23:59:59.999999Z',
    expected: ['1970-01-01'],
  },
  {
    label: 'negative-epoch-exclusive-month-end',
    month: '1970-01',
    starts_at: '1969-12-31T14:59:59.999999Z',
    ends_at: '1969-12-31T15:00:00.000000Z',
    expected: [],
  },
  {
    label: 'negative-epoch-one-microsecond-month-overlap',
    month: '1970-01',
    starts_at: '1969-12-31T14:59:59.999999Z',
    ends_at: '1969-12-31T15:00:00.000001Z',
    expected: ['1970-01-01'],
  },
  {
    label: 'offset-string-microseconds',
    month: '2026-10',
    starts_at: '2026-10-02T00:00:00.000001+09:00',
    ends_at: '2026-10-02T00:00:00.000002+09:00',
    expected: ['2026-10-02'],
  },
  {
    label: 'unknown-end-boundary-point',
    month: '2026-10',
    starts_at: '2026-10-01T15:00:00.000001Z',
    ends_at: null,
    expected: ['2026-10-02'],
  },
  {
    label: 'far-future-one-microsecond-duration',
    month: '9999-12',
    starts_at: '9999-12-31T14:59:59.999998Z',
    ends_at: '9999-12-31T14:59:59.999999Z',
    expected: ['9999-12-31'],
  },
  {
    label: 'one-microsecond-nonpositive-duration',
    month: '2026-10',
    starts_at: '2026-10-01T15:00:00.000002Z',
    ends_at: '2026-10-01T15:00:00.000001Z',
    expected: [],
  },
])(
  'places PostgreSQL-precision event $label without mutating cursor strings',
  ({ month, starts_at, ends_at, expected }) => {
    const event = { starts_at, ends_at };
    const before = JSON.stringify(event);
    expect(scheduleDayKeys(event, month)).toEqual(expected);
    expect(JSON.stringify(event)).toBe(before);
    expect(event.starts_at).toBe(starts_at);
    expect(event.ends_at).toBe(ends_at);
  },
);
