import 'server-only';
import { z } from 'zod';
import {
  SETTLEMENT_REPORTS,
  settlementReportCalculateSchema,
  settlementReportConfirmSchema,
  settlementReportEnvelopeSchema,
  settlementReportQuerySchema,
  type SettlementReport,
  type SettlementReportEnvelope,
  type SettlementReportMode,
  type SettlementReportQuery,
  type SettlementReportResult,
} from '@/config/settlement-reports';
import {
  SETTLEMENT_CALCULATION,
  settlementMonthSchema,
} from '@/config/settlement-calculation';
import {
  add,
  decimalRate,
  divide,
  exact,
  minimum,
  multiply,
  roundHalfUpNonnegative,
  subtract,
  type Exact,
} from '@/server/services/settlement/exact';

export type SettlementReportsPort = {
  read(
    query: SettlementReportQuery,
  ): Promise<SettlementReportResult<SettlementReportEnvelope>>;
  calculate(
    query: z.output<typeof settlementReportCalculateSchema>,
  ): Promise<SettlementReportResult<SettlementReportEnvelope>>;
  confirm(
    query: z.output<typeof settlementReportConfirmSchema>,
  ): Promise<SettlementReportResult<SettlementReportEnvelope>>;
  export(
    query: z.output<typeof settlementReportConfirmSchema>,
  ): Promise<SettlementReportResult<SettlementReportEnvelope>>;
};
const parameters = z.strictObject({
  artist_id: z.uuid().toLowerCase().optional(),
  month: z.string().optional(),
});
export function resolveSettlementReportQuery(
  input: unknown,
  now = new Date(),
): SettlementReportResult<{
  query: SettlementReportQuery | null;
  artistId: string;
  month: string;
}> {
  const parsed = parameters.safeParse(input);
  if (!parsed.success || !Number.isFinite(now.getTime()))
    return { ok: false, code: 'INVALID_INPUT' };
  const kst = new Date(now.getTime() + SETTLEMENT_CALCULATION.kstOffsetMs);
  const previous = new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - 1, 1),
  )
    .toISOString()
    .slice(0, SETTLEMENT_CALCULATION.dateLength);
  const month = parsed.data.month ?? previous;
  const checkedMonth = settlementMonthSchema.safeParse(month);
  if (!checkedMonth.success) return { ok: false, code: 'INVALID_INPUT' };
  return {
    ok: true,
    data: {
      query: parsed.data.artist_id
        ? { artistId: parsed.data.artist_id, month }
        : null,
      artistId: parsed.data.artist_id ?? '',
      month,
    },
  };
}
function integer(value: string) {
  return BigInt(value.split('.')[0]!);
}
function equal(left: Exact, right: Exact) {
  return (
    left.numerator * right.denominator === right.numerator * left.denominator
  );
}
function pair(value: [string, string]) {
  return exact(integer(value[0]), integer(value[1]));
}
function decimal(value: string) {
  const [whole = '', digits = ''] = value.split('.');
  return exact(
    BigInt(whole + digits),
    SETTLEMENT_CALCULATION.decimalBase ** BigInt(digits.length),
  );
}
// PostgreSQL numeric division chooses scale by significant digits, not a fixed
// number of fractional places. Derive a conservative 16-significant-digit
// lower bound from the authoritative rational itself: displayed zero or a
// rounded power-of-ten boundary must not weaken the precision check.
function minimumDisplayPlaces(rational: Exact) {
  const numerator = rational.numerator;
  const denominator = rational.denominator;
  let exponent = numerator.toString().length - denominator.toString().length;
  const belowPower =
    exponent >= 0
      ? numerator <
        denominator * SETTLEMENT_CALCULATION.decimalBase ** BigInt(exponent)
      : numerator * SETTLEMENT_CALCULATION.decimalBase ** BigInt(-exponent) <
        denominator;
  if (belowPower) exponent--;
  return Math.max(
    0,
    SETTLEMENT_REPORTS.minimumApproximationSignificantDigits - 1 - exponent,
  );
}
// Saved rational pairs, not Number/display text, are authoritative. Bound the
// display error to one last-place unit (covering PostgreSQL rounded and the
// pure calculator's truncated projections), never round a payout from it.
function displayMatches(value: string, rational: Exact) {
  const displayed = decimal(value);
  const delta = subtract(displayed, rational);
  const places = value.split('.')[1]?.length ?? 0;
  if (delta.numerator === SETTLEMENT_CALCULATION.zero) return true;
  if (places < minimumDisplayPlaces(rational)) return false;
  const units = SETTLEMENT_CALCULATION.decimalBase ** BigInt(places);
  if (
    (rational.numerator * units) % rational.denominator ===
    SETTLEMENT_CALCULATION.zero
  )
    return false;
  const absolute =
    delta.numerator < SETTLEMENT_CALCULATION.zero
      ? -delta.numerator
      : delta.numerator;
  return absolute * units <= delta.denominator;
}
function snapshotMatches(data: SettlementReportEnvelope): boolean {
  const report = data.report;
  if (!report) return data.sources === null;
  const policy = report.policySnapshot;
  const start = Date.parse(`${data.month}T00:00:00+09:00`);
  const nextMonth = new Date(Date.parse(data.month));
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const endDate = nextMonth
    .toISOString()
    .slice(0, SETTLEMENT_CALCULATION.dateLength);
  const end = Date.parse(`${endDate}T00:00:00+09:00`);
  if (
    policy.artistId !== data.artist.id ||
    policy.month !== data.month ||
    policy.contractFrom > data.month ||
    policy.contractUntil < endDate ||
    Date.parse(report.periodStart) !== start ||
    Date.parse(report.periodEnd) !== end ||
    Date.parse(report.calculatedAt) < end ||
    (report.confirmedAt !== null &&
      Date.parse(report.confirmedAt) < Date.parse(report.calculatedAt)) ||
    integer(report.grossKrw) !==
      integer(report.currentGrossKrw) + integer(report.adjustmentGrossKrw)
  )
    return false;
  let messages = SETTLEMENT_CALCULATION.zero,
    photos = SETTLEMENT_CALCULATION.zero,
    window = data.month;
  const weekStarts = new Set<string>();
  for (const week of report.weeklyStats) {
    const days =
      (Date.parse(week.windowEnd) - Date.parse(week.windowStart)) /
      SETTLEMENT_CALCULATION.dayMs;
    const expectedStart = new Date(Date.parse(week.windowStart));
    const day = expectedStart.getUTCDay();
    expectedStart.setUTCDate(
      expectedStart.getUTCDate() -
        ((day +
          SETTLEMENT_CALCULATION.daysPerWeek -
          SETTLEMENT_CALCULATION.mondayIndex) %
          SETTLEMENT_CALCULATION.daysPerWeek),
    );
    const nextWeek = new Date(
      expectedStart.getTime() +
        SETTLEMENT_CALCULATION.daysPerWeek * SETTLEMENT_CALCULATION.dayMs,
    )
      .toISOString()
      .slice(0, SETTLEMENT_CALCULATION.dateLength);
    if (
      week.windowStart !== window ||
      week.windowEnd !== (nextWeek < endDate ? nextWeek : endDate) ||
      days <= 0 ||
      days > SETTLEMENT_CALCULATION.daysPerWeek ||
      week.weekStart !==
        expectedStart
          .toISOString()
          .slice(0, SETTLEMENT_CALCULATION.dateLength) ||
      weekStarts.has(week.weekStart) ||
      integer(week.photoCount) > integer(week.messageCount)
    )
      return false;
    weekStarts.add(week.weekStart);
    window = week.windowEnd;
    if (
      policy.activityEnabled &&
      policy.partialWeekPolicy === 'block' &&
      days !== SETTLEMENT_CALCULATION.daysPerWeek
    )
      return false;
    const messageRequired = policy.activityEnabled
      ? exact(
          BigInt(days) * BigInt(policy.weeklyMessageMin!),
          BigInt(SETTLEMENT_CALCULATION.daysPerWeek),
        )
      : exact(SETTLEMENT_CALCULATION.zero);
    const photoRequired = policy.activityEnabled
      ? exact(
          BigInt(days) * BigInt(policy.weeklyPhotoMin!),
          BigInt(SETTLEMENT_CALCULATION.daysPerWeek),
        )
      : exact(SETTLEMENT_CALCULATION.zero);
    if (
      !displayMatches(week.messageRequired, messageRequired) ||
      !displayMatches(week.photoRequired, photoRequired)
    )
      return false;
    messages += integer(week.messageCount);
    photos += integer(week.photoCount);
  }
  if (window !== endDate || messages !== integer(report.sourceMessageCount))
    return false;
  const one = exact(SETTLEMENT_CALCULATION.one),
    gross = exact(integer(report.grossKrw)),
    vatRate = decimalRate(policy.vatRate),
    pgRate = decimalRate(policy.pgFeeRate),
    rate = decimalRate(policy.baseRate);
  const vat = divide(multiply(gross, vatRate), add(one, vatRate));
  const pg = divide(multiply(gross, pgRate), add(one, vatRate));
  const base = subtract(subtract(gross, vat), pg),
    share = multiply(base, rate);
  const days = BigInt((end - start) / SETTLEMENT_CALCULATION.dayMs);
  const ratio = policy.activityEnabled
    ? minimum(
        one,
        divide(
          add(
            divide(
              exact(messages * BigInt(SETTLEMENT_CALCULATION.daysPerWeek)),
              exact(days * BigInt(policy.weeklyMessageMin!)),
            ),
            divide(
              exact(photos * BigInt(SETTLEMENT_CALCULATION.daysPerWeek)),
              exact(days * BigInt(policy.weeklyPhotoMin!)),
            ),
          ),
          exact(SETTLEMENT_CALCULATION.ratioTerms),
        ),
      )
    : one;
  const deduction = multiply(share, subtract(one, ratio)),
    final = multiply(share, ratio);
  const expected = {
    vat,
    pg_fee: pg,
    base,
    share,
    activity_ratio: ratio,
    deduction,
    final,
  };
  if (
    Object.entries(expected).some(
      ([key, value]) =>
        !equal(
          pair(report.exactComponents[key as keyof typeof expected]),
          value,
        ),
    )
  )
    return false;
  const projections: [string, Exact][] = [
    [report.vatKrw, vat],
    [report.pgFeeKrw, pg],
    [report.baseAmountKrw, base],
    [report.rate, rate],
    [report.activityRatio, ratio],
    [report.deductionKrw, deduction],
    [report.unroundedFinalKrw, final],
  ];
  if (
    projections.some(([value, rational]) => !displayMatches(value, rational)) ||
    integer(report.finalAmountKrw).toString() !== roundHalfUpNonnegative(final)
  )
    return false;
  if (data.sources !== null) {
    if (
      data.actorRole !== 'admin' ||
      BigInt(data.sources.length) !== integer(report.sourceEventCount)
    )
      return false;
    const ids = new Set<string>();
    let current = SETTLEMENT_CALCULATION.zero,
      adjustment = SETTLEMENT_CALCULATION.zero;
    for (const source of data.sources) {
      const amount = BigInt(source.amountKrw),
        at = Date.parse(source.occurredAt);
      if (
        ids.has(source.id) ||
        (source.kind === 'charge'
          ? amount <= SETTLEMENT_CALCULATION.zero
          : amount >= SETTLEMENT_CALCULATION.zero) ||
        (source.origin === 'current'
          ? at < start || at >= end
          : at >= start ||
            policy.lateEventPolicy !== 'explicit_current_formula')
      )
        return false;
      ids.add(source.id);
      if (source.origin === 'current') current += amount;
      else adjustment += amount;
    }
    if (
      current !== integer(report.currentGrossKrw) ||
      adjustment !== integer(report.adjustmentGrossKrw)
    )
      return false;
  }
  return true;
}
export function validateSettlementReportEnvelope(
  input: unknown,
): SettlementReportResult<SettlementReportEnvelope> {
  try {
    const parsed = settlementReportEnvelopeSchema.safeParse(input);
    return parsed.success && snapshotMatches(parsed.data)
      ? { ok: true, data: parsed.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
async function invoke(
  portCall: () => Promise<SettlementReportResult<SettlementReportEnvelope>>,
  actorId: string,
  mode: SettlementReportMode,
  predicate: (data: SettlementReportEnvelope) => boolean,
): Promise<SettlementReportResult<SettlementReportEnvelope>> {
  if (!z.uuid().safeParse(actorId).success)
    return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await portCall();
    if (!result.ok) return result;
    const checked = validateSettlementReportEnvelope(result.data);
    if (!checked.ok) return checked;
    return checked.data.actorId === actorId.toLowerCase() &&
      checked.data.actorRole === mode &&
      predicate(checked.data)
      ? checked
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export function readSettlementReport(
  port: SettlementReportsPort,
  input: unknown,
  actorId: string,
  mode: SettlementReportMode,
) {
  const query = settlementReportQuerySchema.safeParse(input);
  if (!query.success)
    return Promise.resolve({ ok: false, code: 'INVALID_INPUT' } as const);
  return invoke(
    () => port.read(query.data),
    actorId,
    mode,
    (data) =>
      data.artist.id === query.data.artistId &&
      data.month === query.data.month &&
      data.sources === null,
  );
}
export function calculateSettlementReport(
  port: SettlementReportsPort,
  input: unknown,
  actorId: string,
) {
  const query = settlementReportCalculateSchema.safeParse(input);
  if (!query.success)
    return Promise.resolve({ ok: false, code: 'INVALID_INPUT' } as const);
  return invoke(
    () => port.calculate(query.data),
    actorId,
    'admin',
    (data) =>
      data.artist.id === query.data.artistId &&
      data.month === query.data.month &&
      data.sources === null &&
      data.report?.status === 'draft' &&
      data.report.revision !== query.data.expectedRevision,
  );
}
export function confirmSettlementReport(
  port: SettlementReportsPort,
  input: unknown,
  actorId: string,
) {
  const query = settlementReportConfirmSchema.safeParse(input);
  if (!query.success)
    return Promise.resolve({ ok: false, code: 'INVALID_INPUT' } as const);
  return invoke(
    () => port.confirm(query.data),
    actorId,
    'admin',
    (data) =>
      data.sources === null &&
      data.report?.id === query.data.reportId &&
      data.report.revision === query.data.expectedRevision &&
      data.report.status === 'confirmed',
  );
}
export function readSettlementExport(
  port: SettlementReportsPort,
  input: unknown,
  actorId: string,
) {
  const query = settlementReportConfirmSchema.safeParse(input);
  if (!query.success)
    return Promise.resolve({ ok: false, code: 'INVALID_INPUT' } as const);
  return invoke(
    () => port.export(query.data),
    actorId,
    'admin',
    (data) =>
      data.sources !== null &&
      data.report?.id === query.data.reportId &&
      data.report.revision === query.data.expectedRevision,
  );
}
export type { SettlementReport };
