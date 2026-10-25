import { describe, expect, it } from 'vitest';
import {
  scheduleMonthShift,
  scheduleMonthDays,
  scheduleDayKeys,
  scheduleToLocalDateTime,
  scheduleFromLocalDateTime,
  scheduleEditedDateTime,
} from '@/lib/schedule-view';
describe('KST schedule calendar rendering arithmetic', () => {
  it.each([
    ['2026-12', 1, '2027-01'],
    ['2026-01', -1, '2025-12'],
    ['0001-01', -1, null],
    ['9999-12', 1, null],
    ['0001-01', 1, '0001-02'],
    ['0099-12', 1, '0100-01'],
    ['2024-2', 1, null],
    ['0000-01', 1, null],
    ['bad', 1, null],
    ['2026-01', Infinity, null],
  ])('shifts %s by %s', (month, delta, expected) =>
    expect(scheduleMonthShift(month, delta)).toBe(expected),
  );
  it('includes all actual month days without Date.UTC low-year remapping', () => {
    expect(scheduleMonthDays('0001-02')).toHaveLength(28);
    expect(scheduleMonthDays('2024-02')).toHaveLength(29);
    expect(scheduleMonthDays('1900-02')).toHaveLength(28);
    expect(scheduleMonthDays('2000-02')).toHaveLength(29);
    expect(scheduleMonthDays('9999-12').at(-1)).toBe('9999-12-31');
    expect(scheduleMonthDays('2026-13')).toEqual([]);
  });
  it('renders overlapping events clipped to month and excludes exclusive midnight end', () => {
    expect(
      scheduleDayKeys(
        { starts_at: '2026-09-30T14:00:00Z', ends_at: '2026-10-02T15:00:00Z' },
        '2026-10',
      ),
    ).toEqual(['2026-10-01', '2026-10-02']);
    expect(
      scheduleDayKeys(
        { starts_at: '2026-09-30T15:00:00Z', ends_at: null },
        '2026-10',
      ),
    ).toEqual(['2026-10-01']);
    expect(
      scheduleDayKeys(
        { starts_at: '2026-10-01T14:00:00Z', ends_at: '2026-10-01T15:00:00Z' },
        '2026-10',
      ),
    ).toEqual(['2026-10-01']);
    expect(
      scheduleDayKeys(
        { starts_at: '2026-09-01T00:00:00Z', ends_at: null },
        '2026-10',
      ),
    ).toEqual([]);
    expect(
      scheduleDayKeys({ starts_at: 'bad', ends_at: null }, '2026-10'),
    ).toEqual([]);
  });
  it('converts KST date/time independent of browser timezone including low years', () => {
    expect(scheduleToLocalDateTime('2026-10-31T15:05:00Z')).toEqual({
      date: '2026-11-01',
      time: '00:05',
    });
    expect(scheduleFromLocalDateTime('0001-01-01', '00:00')).toBeNull();
    expect(scheduleFromLocalDateTime('2026-11-01', '00:05')).toBe(
      '2026-10-31T15:05:00.000Z',
    );
  });
  it.each([
    ['2026-02-30', '10:00'],
    ['2026-01-01', '24:00'],
    ['2026-01-01', '1:05'],
    ['0000-01-01', '10:00'],
    ['2026-12-01', ''],
    ['bad', '10:00'],
  ])('rejects normalized or invalid input %s %s', (date, time) =>
    expect(scheduleFromLocalDateTime(date, time)).toBeNull(),
  );
});

it('preserves exact existing seconds and microseconds when a displayed minute did not change', () => {
  const original = '2026-10-25T09:00:45.123456Z';
  expect(scheduleEditedDateTime(original, '2026-10-25', '18:00')).toBe(
    original,
  );
  expect(scheduleEditedDateTime(original, '2026-10-25', '18:01')).toBe(
    '2026-10-25T09:01:00.000Z',
  );
  expect(scheduleEditedDateTime(null, '2026-10-25', '18:01')).toBe(
    '2026-10-25T09:01:00.000Z',
  );
  expect(scheduleEditedDateTime(original, '', '')).toBeNull();
});

it('permits only the exact exclusive local10000 endpoint with valid four-digit UTC serialization', () => {
  const boundary = '9999-12-31T15:00:00.000Z';
  expect(scheduleToLocalDateTime(boundary)).toEqual({
    date: '10000-01-01',
    time: '00:00',
  });
  expect(scheduleEditedDateTime(boundary, '10000-01-01', '00:00')).toBe(
    boundary,
  );
  expect(scheduleFromLocalDateTime('10000-01-01', '00:00')).toBe(boundary);
  expect(scheduleFromLocalDateTime('10000-01-01', '00:01')).toBeNull();
  expect(scheduleFromLocalDateTime('10000-01-02', '00:00')).toBeNull();
  expect(scheduleFromLocalDateTime('10001-01-01', '00:00')).toBeNull();
});
