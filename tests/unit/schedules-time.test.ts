import { expect, it } from 'vitest';
import { scheduleInstantMicroseconds } from '@/lib/schedule-time';
import {
  adminScheduleInputSchema,
  scheduleEventSchema,
  SCHEDULES,
} from '@/config/schedules';
import { scheduleSave, scheduleEvent } from './schedules-fixtures';
it.each([
  ['1970-01-01T00:00:00.000001Z', 1n],
  ['1969-12-31T23:59:59.999999Z', -1n],
  ['1970-01-01T09:00:00.000001+09:00', 1n],
  ['1969-12-31T18:59:59.999999-05:00', -1n],
  ['1970-01-01T00:00:00Z', 0n],
  ['1970-01-01T00:00:00.1Z', 100000n],
  ['1970-01-01T00:00:00.1234Z', 123400n],
  ['1970-01-01T00:00:00.123456Z', 123456n],
])('parses PostgreSQL microsecond instant %s', (input, expected) =>
  expect(scheduleInstantMicroseconds(input)).toBe(expected),
);
it.each(['invalid', 'infinity', ''])('rejects invalid instant %s', (input) =>
  expect(scheduleInstantMicroseconds(input)).toBeNull(),
);
it('accepts one-microsecond interval end-to-end without rounding event projection', () => {
  const starts_at = '2026-10-31T14:59:59.999999Z',
    ends_at = '2026-10-31T15:00:00.000000Z';
  const event = { ...scheduleEvent, starts_at, ends_at };
  expect(scheduleEventSchema.parse(event)).toEqual(event);
  expect(
    adminScheduleInputSchema.safeParse({
      ...scheduleSave.input,
      starts_at,
      ends_at,
    }).success,
  ).toBe(true);
});
it.each([
  {
    starts_at: '2026-10-25T00:00:00.000002Z',
    ends_at: '2026-10-25T00:00:00.000001Z',
  },
  {
    starts_at: '2026-10-25T00:00:00.000001Z',
    ends_at: '2026-10-25T00:00:00.000001Z',
  },
  { starts_at: '2026-10-25T00:00:00.1234567Z', ends_at: null },
  { starts_at: '2026-10-25T00:00Z', ends_at: null },
  { starts_at: '0001-01-01T00:00:00+09:00', ends_at: null },
  {
    starts_at: '9999-12-31T14:59:59.999999Z',
    ends_at: '9999-12-31T15:00:00.000001Z',
  },
  { starts_at: '9999-12-31T15:00:00.000000Z', ends_at: null },
])('rejects exact unsupported wire interval %#', (dates) => {
  expect(
    adminScheduleInputSchema.safeParse({ ...scheduleSave.input, ...dates })
      .success,
  ).toBe(false);
  expect(
    scheduleEventSchema.safeParse({ ...scheduleEvent, ...dates }).success,
  ).toBe(false);
});
it('retains exact allowed lower/upper endpoints', () => {
  expect(
    adminScheduleInputSchema.safeParse({
      ...scheduleSave.input,
      starts_at: SCHEDULES.minInstant,
      ends_at: null,
    }).success,
  ).toBe(true);
  expect(
    adminScheduleInputSchema.safeParse({
      ...scheduleSave.input,
      starts_at: '9999-12-31T14:59:59.999999Z',
      ends_at: SCHEDULES.maxInstant,
    }).success,
  ).toBe(true);
});
