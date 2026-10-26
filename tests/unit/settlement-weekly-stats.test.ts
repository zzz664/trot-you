// @vitest-environment node
import { expect, it } from 'vitest';
import type {
  SettlementCalculationPolicy,
  SettlementCalculationMessage,
} from '@/config/settlement-calculation';
import {
  aggregateSettlementWeeklyStats,
  settlementMonthWindow,
  settlementTimestampMicros,
} from '@/server/services/settlement/weekly-stats';

const policy: SettlementCalculationPolicy = {
  id: '10400000-0000-4000-8000-000000000001',
  artistId: '10400000-0000-4000-8000-000000000002',
  month: '2026-09-01',
  enabled: true,
  contractFrom: '2020-01-01',
  contractUntil: '2030-01-01',
  baseRate: '0.3',
  performanceRate: '0.4',
  performanceConditions: null,
  vatRate: '0.1',
  pgFeeRate: '0.03',
  activityEnabled: true,
  weeklyMessageMin: 3,
  weeklyPhotoMin: 2,
  partialWeekPolicy: 'prorate_days',
  negativeNetPolicy: 'block',
  lateEventPolicy: 'block',
};
const message = (
  index: number,
  sentAt: string,
  type: SettlementCalculationMessage['type'] = 'text',
) => ({
  id: `10400000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  type,
  sentAt,
});
const aggregate = (
  messages: SettlementCalculationMessage[] = [],
  override: Partial<SettlementCalculationPolicy> = {},
) => {
  const actual = { ...policy, ...override };
  return aggregateSettlementWeeklyStats({
    month: actual.month,
    policy: actual,
    messages,
  });
};
it('builds five clipped Monday KST windows including empty weeks without inventing subscriber counts', () => {
  const result = aggregate();
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  expect(
    result.data.map(({ weekStart, windowStart, windowEnd }) => ({
      weekStart,
      windowStart,
      windowEnd,
    })),
  ).toEqual([
    {
      weekStart: '2026-08-31',
      windowStart: '2026-09-01',
      windowEnd: '2026-09-07',
    },
    {
      weekStart: '2026-09-07',
      windowStart: '2026-09-07',
      windowEnd: '2026-09-14',
    },
    {
      weekStart: '2026-09-14',
      windowStart: '2026-09-14',
      windowEnd: '2026-09-21',
    },
    {
      weekStart: '2026-09-21',
      windowStart: '2026-09-21',
      windowEnd: '2026-09-28',
    },
    {
      weekStart: '2026-09-28',
      windowStart: '2026-09-28',
      windowEnd: '2026-10-01',
    },
  ]);
  expect(result.data[0]?.messageRequired.exact).toEqual({
    numerator: '18',
    denominator: '7',
  });
  expect(result.data[0]?.photoRequired.exact).toEqual({
    numerator: '12',
    denominator: '7',
  });
  expect(result.data[4]?.messageRequired.exact).toEqual({
    numerator: '9',
    denominator: '7',
  });
  for (const week of result.data) {
    expect(week.messageCount).toBe('0');
    expect(week.photoCount).toBe('0');
    expect(week).not.toHaveProperty('subscriberCount');
  }
});
it('counts photo messages once and assigns microsecond week boundaries exactly', () => {
  const result = aggregate([
    message(10, '2026-08-31T15:00:00Z', 'photo'),
    message(11, '2026-09-06T14:59:59.999999Z', 'photo'),
    message(12, '2026-09-06T15:00:00Z', 'video'),
    message(13, '2026-09-14T00:00:00+09:00', 'voice'),
    message(14, '2026-09-30T14:59:59.999999Z', 'text'),
  ]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  expect(
    result.data.map((week) => [week.messageCount, week.photoCount]),
  ).toEqual([
    ['2', '2'],
    ['1', '0'],
    ['1', '0'],
    ['0', '0'],
    ['1', '0'],
  ]);
});
it.each([
  '2026-08-31T14:59:59.999999Z',
  '2026-09-30T15:00:00Z',
  '2026-10-01T00:00:00.000001+09:00',
])('rejects message outside the half-open month at %s', (sentAt) => {
  expect(aggregate([message(20, sentAt)])).toEqual({
    ok: false,
    code: 'SOURCE_MISMATCH',
  });
});
it('rejects duplicate source IDs even when the second timestamp differs', () => {
  expect(
    aggregate([
      message(20, '2026-09-01T00:00:00Z'),
      message(20, '2026-09-20T00:00:00Z'),
    ]),
  ).toEqual({ ok: false, code: 'SOURCE_MISMATCH' });
});
it('requires explicit proration for partial weeks but supports four complete weeks', () => {
  expect(aggregate([], { partialWeekPolicy: 'block' })).toEqual({
    ok: false,
    code: 'PARTIAL_WEEK_POLICY_REQUIRED',
  });
  const result = aggregate([], {
    month: '2021-02-01',
    partialWeekPolicy: 'block',
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  expect(result.data).toHaveLength(4);
  expect(
    result.data.every(
      (week) =>
        week.messageRequired.decimal === '3' &&
        week.photoRequired.decimal === '2',
    ),
  ).toBe(true);
});
it('explicitly disabled activity uses zero requirements without an implicit policy fallback', () => {
  const result = aggregate([], {
    activityEnabled: false,
    weeklyMessageMin: null,
    weeklyPhotoMin: null,
    partialWeekPolicy: 'block',
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  expect(
    result.data.every(
      (week) =>
        week.messageRequired.decimal === '0' &&
        week.photoRequired.decimal === '0',
    ),
  ).toBe(true);
});
it.each([
  { weeklyMessageMin: 0 },
  { weeklyPhotoMin: null },
  { weeklyMessageMin: -1 },
  { weeklyPhotoMin: 2.5 },
  { weeklyMessageMin: Number.MAX_SAFE_INTEGER + 1 },
  { activityEnabled: false },
])(
  'rejects missing, zero, fractional or inconsistent requirements %j',
  (override) => {
    expect(aggregate([], override)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
  },
);
it.each([
  ['2024-02-01', '2024-01-31T15:00:00.000Z', '2024-02-29T15:00:00.000Z'],
  ['2026-12-01', '2026-11-30T15:00:00.000Z', '2026-12-31T15:00:00.000Z'],
  ['2000-01-01', '1999-12-31T15:00:00.000Z', '2000-01-31T15:00:00.000Z'],
])('creates exact KST month boundary %s', (month, periodStart, periodEnd) => {
  expect(settlementMonthWindow(month)).toMatchObject({
    periodStart,
    periodEnd,
  });
});
it('preserves microsecond timestamp comparisons and equivalent offsets', () => {
  expect(
    settlementTimestampMicros('2026-09-30T15:00:00.000001Z') -
      settlementTimestampMicros('2026-09-30T15:00:00Z'),
  ).toBe(1n);
  expect(settlementTimestampMicros('2026-10-01T00:00:00+09:00')).toBe(
    settlementTimestampMicros('2026-09-30T15:00:00Z'),
  );
  expect(() => settlementTimestampMicros('bad')).toThrow('INVALID_TIMESTAMP');
});
it('rejects mismatched month and partial-month contracts', () => {
  expect(
    aggregateSettlementWeeklyStats({
      month: '2026-08-01',
      policy,
      messages: [],
    }),
  ).toEqual({ ok: false, code: 'SOURCE_MISMATCH' });
  expect(aggregate([], { contractFrom: '2026-09-02' })).toEqual({
    ok: false,
    code: 'FULL_MONTH_CONTRACT_REQUIRED',
  });
  expect(aggregate([], { contractUntil: '2026-09-30' })).toEqual({
    ok: false,
    code: 'FULL_MONTH_CONTRACT_REQUIRED',
  });
});
