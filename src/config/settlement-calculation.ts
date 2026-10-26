import { z } from 'zod';

// Technical bounds and exact unit conversions, not approved financial defaults.
export const SETTLEMENT_CALCULATION = {
  zero: 0n,
  one: 1n,
  timeZone: 'Asia/Seoul',
  currency: 'KRW',
  maxSourceRows: 50_000,
  maxIntegerDigits: 100,
  rateScale: 6,
  decimalPlaces: 30,
  earliestMonth: '2000-01-01',
  latestMonth: '9998-12-01',
  dateLength: 10,
  dayMs: 86_400_000,
  kstOffsetMs: 32_400_000,
  microsecondsPerMillisecond: 1_000n,
  microsecondPlaces: 6,
  daysPerWeek: 7,
  ratioTerms: 2n,
  decimalBase: 10n,
  mondayIndex: 1,
} as const;

export const SETTLEMENT_CALCULATION_ERRORS = [
  'INVALID_INPUT',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'UNAVAILABLE',
  'POLICY_REQUIRED',
  'MONTH_OPEN',
  'CONFIRMED',
  'FULL_MONTH_CONTRACT_REQUIRED',
  'PARTIAL_WEEK_POLICY_REQUIRED',
  'ADJUSTMENT_POLICY_REQUIRED',
  'NEGATIVE_NET_REQUIRES_POLICY',
  'SOURCE_MISMATCH',
  'SOURCE_LIMIT_EXCEEDED',
] as const;
export type SettlementCalculationError =
  (typeof SETTLEMENT_CALCULATION_ERRORS)[number];
export type SettlementCalculationResult<T> =
  { ok: true; data: T } | { ok: false; code: SettlementCalculationError };

export const settlementMonthSchema = z.iso
  .date()
  .refine(
    (value) =>
      value.endsWith('-01') &&
      value >= SETTLEMENT_CALCULATION.earliestMonth &&
      value <= SETTLEMENT_CALCULATION.latestMonth,
  );
export const settlementTimestampSchema = z.iso
  .datetime({ offset: true })
  .refine(
    (value) =>
      /T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      Number.isFinite(Date.parse(value)),
  );
const unsignedInteger = z
  .string()
  .max(SETTLEMENT_CALCULATION.maxIntegerDigits)
  .regex(/^(?:0|[1-9]\d*)$/);
const signedInteger = z
  .string()
  .max(SETTLEMENT_CALCULATION.maxIntegerDigits)
  .regex(/^(?:0|-?[1-9]\d*)$/);
const rate = z.string().regex(/^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/);
const minimum = z.number().int().positive().safe().nullable();
export const settlementCalculationQuerySchema = z.strictObject({
  artistId: z.uuid().toLowerCase(),
  month: settlementMonthSchema,
});
export const settlementCalculationPolicySchema = z
  .strictObject({
    id: z.uuid().toLowerCase(),
    artistId: z.uuid().toLowerCase(),
    month: settlementMonthSchema,
    enabled: z.literal(true),
    contractFrom: z.iso.date(),
    contractUntil: z.iso.date(),
    baseRate: rate,
    performanceRate: rate,
    performanceConditions: z.null(),
    vatRate: rate,
    pgFeeRate: rate,
    activityEnabled: z.boolean(),
    weeklyMessageMin: minimum,
    weeklyPhotoMin: minimum,
    partialWeekPolicy: z.enum(['block', 'prorate_days']),
    negativeNetPolicy: z.literal('block'),
    lateEventPolicy: z.enum(['block', 'explicit_current_formula']),
  })
  .refine(
    (policy) =>
      policy.contractUntil > policy.contractFrom &&
      (policy.activityEnabled
        ? policy.weeklyMessageMin !== null && policy.weeklyPhotoMin !== null
        : policy.weeklyMessageMin === null && policy.weeklyPhotoMin === null),
  );
export const settlementCalculationEventSchema = z.strictObject({
  id: z.uuid().toLowerCase(),
  // Attempt outcomes (initial/renewal/retry/failed/unknown) are not money.
  kind: z.enum(['charge', 'refund']),
  amountKrw: signedInteger,
  occurredAt: settlementTimestampSchema,
  origin: z.enum(['current', 'adjustment']),
  currency: z.literal(SETTLEMENT_CALCULATION.currency),
  verified: z.literal(true),
});
export const settlementCalculationMessageSchema = z.strictObject({
  id: z.uuid().toLowerCase(),
  type: z.enum(['text', 'photo', 'voice', 'video']),
  sentAt: settlementTimestampSchema,
});
export const settlementCalculationInputSchema = z.strictObject({
  artistId: z.uuid().toLowerCase(),
  month: settlementMonthSchema,
  asOf: settlementTimestampSchema,
  sourceVersion: unsignedInteger,
  policy: settlementCalculationPolicySchema,
  events: z
    .array(settlementCalculationEventSchema)
    .max(SETTLEMENT_CALCULATION.maxSourceRows),
  messages: z
    .array(settlementCalculationMessageSchema)
    .max(SETTLEMENT_CALCULATION.maxSourceRows),
});
export const settlementCalculationEnvelopeSchema = z.strictObject({
  actorId: z.uuid().toLowerCase(),
  input: settlementCalculationInputSchema,
});
export type SettlementCalculationEnvelope = z.output<
  typeof settlementCalculationEnvelopeSchema
>;
export const settlementWeeklyStatsInputSchema = z.strictObject({
  month: settlementMonthSchema,
  policy: settlementCalculationPolicySchema,
  messages: z
    .array(settlementCalculationMessageSchema)
    .max(SETTLEMENT_CALCULATION.maxSourceRows),
});
export type SettlementCalculationQuery = z.output<
  typeof settlementCalculationQuerySchema
>;
export type SettlementCalculationPolicy = z.output<
  typeof settlementCalculationPolicySchema
>;
export type SettlementCalculationInput = z.output<
  typeof settlementCalculationInputSchema
>;
export type SettlementCalculationMessage = z.output<
  typeof settlementCalculationMessageSchema
>;
export type SettlementExactDecimal = {
  decimal: string;
  decimalIsExact: boolean;
  exact: { numerator: string; denominator: string };
};
export type SettlementWeeklyStat = {
  weekStart: string;
  windowStart: string;
  windowEnd: string;
  messageCount: string;
  photoCount: string;
  messageRequired: SettlementExactDecimal;
  photoRequired: SettlementExactDecimal;
};
export type SettlementBreakdown = {
  artistId: string;
  month: string;
  asOf: string;
  sourceVersion: string;
  periodStart: string;
  periodEnd: string;
  currency: typeof SETTLEMENT_CALCULATION.currency;
  policySnapshot: SettlementCalculationPolicy;
  sourceEventCount: string;
  sourceMessageCount: string;
  grossKrw: string;
  currentGrossKrw: string;
  adjustmentGrossKrw: string;
  vatKrw: SettlementExactDecimal;
  pgFeeKrw: SettlementExactDecimal;
  baseAmountKrw: SettlementExactDecimal;
  rate: SettlementExactDecimal;
  shareKrw: SettlementExactDecimal;
  activityRatio: SettlementExactDecimal;
  deductionKrw: SettlementExactDecimal;
  unroundedFinalKrw: SettlementExactDecimal;
  finalAmountKrw: string;
  weeklyStats: SettlementWeeklyStat[];
};
