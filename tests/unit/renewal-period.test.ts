import { describe, expect, it } from 'vitest';
import {
  initialBillingPeriod,
  renewalBillingPeriod,
} from '@/lib/billing-period';
import type { BillingPeriodCalendar } from '@/config/billing-policy';
const utc = 'utc_monthly_clamped';
const seoul = 'seoul_monthly_clamped';
describe('anniversary-anchored renewal calendar', () => {
  it.each([
    [
      '2026-01-31T12:34:56.789Z',
      '2026-02-28T12:34:56.789Z',
      '2026-03-31T12:34:56.789Z',
      utc,
    ],
    [
      '2024-01-31T00:00:00.000Z',
      '2024-02-29T00:00:00.000Z',
      '2024-03-31T00:00:00.000Z',
      utc,
    ],
    [
      '2024-02-29T12:00:00.000Z',
      '2025-02-28T12:00:00.000Z',
      '2025-03-29T12:00:00.000Z',
      utc,
    ],
    [
      '2026-10-30T15:00:00.000Z',
      '2026-11-29T15:00:00.000Z',
      '2026-12-30T15:00:00.000Z',
      seoul,
    ],
    [
      '2026-10-30T15:00:00.000Z',
      '2026-11-30T15:00:00.000Z',
      '2026-12-30T15:00:00.000Z',
      utc,
    ],
    [
      '2026-11-30T01:02:03.004Z',
      '2026-12-30T01:02:03.004Z',
      '2027-01-30T01:02:03.004Z',
      utc,
    ],
  ])('preserves original anchor %s via %s', (anchor, start, end, calendar) => {
    expect(
      renewalBillingPeriod(
        new Date(anchor),
        new Date(start),
        calendar as BillingPeriodCalendar,
      ),
    ).toEqual({ start, end });
  });
  it.each([utc, seoul] as const)(
    'twelve consecutive periods never drift for %s',
    (calendar) => {
      const anchor = new Date('2026-01-30T15:34:56.789Z');
      let period = initialBillingPeriod(anchor, calendar);
      for (let i = 0; i < 12; i++)
        period = renewalBillingPeriod(anchor, new Date(period.end), calendar);
      expect(period.end).toBe(
        calendar === seoul
          ? '2027-02-27T15:34:56.789Z'
          : '2027-02-28T15:34:56.789Z',
      );
    },
  );
  it.each([
    ['invalid', '2026-02-28T00:00:00Z', utc],
    ['2026-01-31T00:00:00Z', 'invalid', utc],
    ['2026-01-31T00:00:00Z', '2026-01-31T00:00:00Z', utc],
    ['2026-01-31T00:00:00Z', '2026-01-30T00:00:00Z', utc],
    ['2026-01-31T00:00:00Z', '2026-02-27T00:00:00Z', utc],
    ['2026-01-31T00:00:00Z', '2026-03-28T00:00:00Z', utc],
    ['2026-01-31T00:00:00Z', '2026-02-28T00:00:01Z', utc],
    ['2026-01-31T00:00:00Z', '2026-02-28T00:00:00Z', 'local_default'],
  ])(
    'rejects unapproved or inconsistent %s / %s / %s',
    (anchor, end, calendar) => {
      expect(() =>
        renewalBillingPeriod(
          new Date(anchor),
          new Date(end),
          calendar as BillingPeriodCalendar,
        ),
      ).toThrow('INVALID_BILLING_PERIOD');
    },
  );
});
