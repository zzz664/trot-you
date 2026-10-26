import 'server-only';
import {
  SETTLEMENT_CALCULATION,
  settlementCalculationInputSchema,
  type SettlementBreakdown,
  type SettlementCalculationResult,
} from '@/config/settlement-calculation';
import {
  add,
  decimalRate,
  describeExact,
  divide,
  exact,
  minimum,
  multiply,
  roundHalfUpNonnegative,
  subtract,
  type Exact,
} from './exact';
import {
  aggregateSettlementWeeklyStats,
  settlementMonthWindow,
  settlementTimestampMicros,
} from './weekly-stats';

// Pure reporting calculation: the authenticated DB boundary supplies a verified
// immutable-money snapshot. This function never authorizes a charge or payout.
export function calculateSettlement(
  input: unknown,
): SettlementCalculationResult<SettlementBreakdown> {
  const parsed = settlementCalculationInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const source = parsed.data;
  if (
    source.policy.artistId !== source.artistId ||
    source.policy.month !== source.month
  )
    return { ok: false, code: 'SOURCE_MISMATCH' };
  const window = settlementMonthWindow(source.month);
  const start = settlementTimestampMicros(window.periodStart);
  const end = settlementTimestampMicros(window.periodEnd);
  if (settlementTimestampMicros(source.asOf) < end)
    return { ok: false, code: 'MONTH_OPEN' };
  const weekly = aggregateSettlementWeeklyStats({
    month: source.month,
    policy: source.policy,
    messages: source.messages,
  });
  if (!weekly.ok) return weekly;
  let currentGross = SETTLEMENT_CALCULATION.zero;
  let adjustmentGross = SETTLEMENT_CALCULATION.zero;
  const seen = new Set<string>();
  for (const event of source.events) {
    const amount = BigInt(event.amountKrw);
    const occurredAt = settlementTimestampMicros(event.occurredAt);
    if (
      seen.has(event.id) ||
      (event.kind === 'charge'
        ? amount <= SETTLEMENT_CALCULATION.zero
        : amount >= SETTLEMENT_CALCULATION.zero)
    )
      return { ok: false, code: 'SOURCE_MISMATCH' };
    seen.add(event.id);
    if (event.origin === 'current') {
      if (occurredAt < start || occurredAt >= end)
        return { ok: false, code: 'SOURCE_MISMATCH' };
      currentGross += amount;
    } else {
      if (source.policy.lateEventPolicy !== 'explicit_current_formula')
        return { ok: false, code: 'ADJUSTMENT_POLICY_REQUIRED' };
      if (occurredAt >= start) return { ok: false, code: 'SOURCE_MISMATCH' };
      adjustmentGross += amount;
    }
  }
  const gross = currentGross + adjustmentGross;
  if (gross < SETTLEMENT_CALCULATION.zero)
    return { ok: false, code: 'NEGATIVE_NET_REQUIRES_POLICY' };
  const one = exact(SETTLEMENT_CALCULATION.one);
  const grossValue = exact(gross);
  const vatRate = decimalRate(source.policy.vatRate);
  const vat = divide(multiply(grossValue, vatRate), add(one, vatRate));
  const pgFee = multiply(
    subtract(grossValue, vat),
    decimalRate(source.policy.pgFeeRate),
  );
  const base = subtract(subtract(grossValue, vat), pgFee);
  // Non-null performance conditions have no approved definition and are
  // rejected by the input schema. Null always selects the approved base rate.
  const rate = decimalRate(source.policy.baseRate);
  const share = multiply(base, rate);
  let activityRatio = one;
  if (source.policy.activityEnabled) {
    const totals = weekly.data.reduce<{
      messages: bigint;
      photos: bigint;
      messageRequired: Exact;
      photoRequired: Exact;
    }>(
      (sum, week) => ({
        messages: sum.messages + BigInt(week.messageCount),
        photos: sum.photos + BigInt(week.photoCount),
        messageRequired: add(
          sum.messageRequired,
          exact(
            BigInt(week.messageRequired.exact.numerator),
            BigInt(week.messageRequired.exact.denominator),
          ),
        ),
        photoRequired: add(
          sum.photoRequired,
          exact(
            BigInt(week.photoRequired.exact.numerator),
            BigInt(week.photoRequired.exact.denominator),
          ),
        ),
      }),
      {
        messages: SETTLEMENT_CALCULATION.zero,
        photos: SETTLEMENT_CALCULATION.zero,
        messageRequired: exact(SETTLEMENT_CALCULATION.zero),
        photoRequired: exact(SETTLEMENT_CALCULATION.zero),
      },
    );
    activityRatio = minimum(
      one,
      divide(
        add(
          divide(exact(totals.messages), totals.messageRequired),
          divide(exact(totals.photos), totals.photoRequired),
        ),
        exact(SETTLEMENT_CALCULATION.ratioTerms),
      ),
    );
  }
  const deduction = multiply(share, subtract(one, activityRatio));
  const final = subtract(share, deduction);
  return {
    ok: true,
    data: {
      artistId: source.artistId,
      month: source.month,
      asOf: source.asOf,
      sourceVersion: source.sourceVersion,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
      currency: SETTLEMENT_CALCULATION.currency,
      policySnapshot: source.policy,
      sourceEventCount: BigInt(source.events.length).toString(),
      sourceMessageCount: BigInt(source.messages.length).toString(),
      grossKrw: gross.toString(),
      currentGrossKrw: currentGross.toString(),
      adjustmentGrossKrw: adjustmentGross.toString(),
      vatKrw: describeExact(vat),
      pgFeeKrw: describeExact(pgFee),
      baseAmountKrw: describeExact(base),
      rate: describeExact(rate),
      shareKrw: describeExact(share),
      activityRatio: describeExact(activityRatio),
      deductionKrw: describeExact(deduction),
      unroundedFinalKrw: describeExact(final),
      finalAmountKrw: roundHalfUpNonnegative(final),
      weeklyStats: weekly.data,
    },
  };
}
