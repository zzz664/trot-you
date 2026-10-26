import 'server-only';
import {
  SETTLEMENT_CALCULATION,
  settlementWeeklyStatsInputSchema,
  type SettlementCalculationResult,
  type SettlementWeeklyStat,
} from '@/config/settlement-calculation';
import { describeExact, exact } from './exact';

export function settlementTimestampMicros(value: string): bigint {
  const match =
    /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new RangeError('INVALID_TIMESTAMP');
  const milliseconds = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(milliseconds)) throw new RangeError('INVALID_TIMESTAMP');
  return (
    BigInt(milliseconds) * SETTLEMENT_CALCULATION.microsecondsPerMillisecond +
    BigInt(
      (match[2] ?? '').padEnd(SETTLEMENT_CALCULATION.microsecondPlaces, '0'),
    )
  );
}
function dateAt(milliseconds: number): string {
  return new Date(milliseconds)
    .toISOString()
    .slice(0, SETTLEMENT_CALCULATION.dateLength);
}
export function settlementMonthWindow(month: string) {
  const startDay = Date.parse(month);
  const next = new Date(startDay);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const endDay = next.getTime();
  return {
    startDay,
    endDay,
    nextMonth: dateAt(endDay),
    periodStart: new Date(
      startDay - SETTLEMENT_CALCULATION.kstOffsetMs,
    ).toISOString(),
    periodEnd: new Date(
      endDay - SETTLEMENT_CALCULATION.kstOffsetMs,
    ).toISOString(),
  };
}
export function aggregateSettlementWeeklyStats(
  input: unknown,
): SettlementCalculationResult<SettlementWeeklyStat[]> {
  const parsed = settlementWeeklyStatsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const { month, policy, messages } = parsed.data;
  const window = settlementMonthWindow(month);
  if (policy.month !== month) return { ok: false, code: 'SOURCE_MISMATCH' };
  if (policy.contractFrom > month || policy.contractUntil < window.nextMonth)
    return { ok: false, code: 'FULL_MONTH_CONTRACT_REQUIRED' };
  const days = SETTLEMENT_CALCULATION.daysPerWeek;
  const mondayOffset =
    (new Date(window.startDay).getUTCDay() +
      days -
      SETTLEMENT_CALCULATION.mondayIndex) %
    days;
  const firstWeek =
    window.startDay - mondayOffset * SETTLEMENT_CALCULATION.dayMs;
  const startMicros = settlementTimestampMicros(window.periodStart);
  const endMicros = settlementTimestampMicros(window.periodEnd);
  const seen = new Set<string>();
  const counts = new Map<number, { messages: bigint; photos: bigint }>();
  for (const message of messages) {
    const at = settlementTimestampMicros(message.sentAt);
    if (seen.has(message.id) || at < startMicros || at >= endMicros)
      return { ok: false, code: 'SOURCE_MISMATCH' };
    seen.add(message.id);
    const day =
      Math.floor(
        (Date.parse(message.sentAt) + SETTLEMENT_CALCULATION.kstOffsetMs) /
          SETTLEMENT_CALCULATION.dayMs,
      ) * SETTLEMENT_CALCULATION.dayMs;
    const week =
      firstWeek +
      Math.floor((day - firstWeek) / (days * SETTLEMENT_CALCULATION.dayMs)) *
        days *
        SETTLEMENT_CALCULATION.dayMs;
    const entry = counts.get(week) ?? {
      messages: SETTLEMENT_CALCULATION.zero,
      photos: SETTLEMENT_CALCULATION.zero,
    };
    entry.messages += SETTLEMENT_CALCULATION.one;
    if (message.type === 'photo') entry.photos += SETTLEMENT_CALCULATION.one;
    counts.set(week, entry);
  }
  const weeks: SettlementWeeklyStat[] = [];
  for (
    let week = firstWeek;
    week < window.endDay;
    week += days * SETTLEMENT_CALCULATION.dayMs
  ) {
    const start = Math.max(week, window.startDay);
    const end = Math.min(
      week + days * SETTLEMENT_CALCULATION.dayMs,
      window.endDay,
    );
    const overlapDays = (end - start) / SETTLEMENT_CALCULATION.dayMs;
    if (
      policy.activityEnabled &&
      overlapDays !== days &&
      policy.partialWeekPolicy === 'block'
    )
      return { ok: false, code: 'PARTIAL_WEEK_POLICY_REQUIRED' };
    const entry = counts.get(week) ?? {
      messages: SETTLEMENT_CALCULATION.zero,
      photos: SETTLEMENT_CALCULATION.zero,
    };
    const required = (minimum: number | null) =>
      describeExact(
        exact(
          policy.activityEnabled
            ? BigInt(overlapDays) * BigInt(minimum!)
            : SETTLEMENT_CALCULATION.zero,
          BigInt(days),
        ),
      );
    weeks.push({
      weekStart: dateAt(week),
      windowStart: dateAt(start),
      windowEnd: dateAt(end),
      messageCount: entry.messages.toString(),
      photoCount: entry.photos.toString(),
      messageRequired: required(policy.weeklyMessageMin),
      photoRequired: required(policy.weeklyPhotoMin),
    });
  }
  return { ok: true, data: weeks };
}
