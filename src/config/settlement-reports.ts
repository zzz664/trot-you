import { z } from 'zod';
import {
  SETTLEMENT_CALCULATION,
  settlementCalculationPolicySchema,
  settlementCalculationEventSchema,
  settlementMonthSchema,
  settlementTimestampSchema,
} from './settlement-calculation';

// Transport bounds only; none of these values approve accounting policy.
export const SETTLEMENT_REPORTS = {
  actorHeader: 'X-Settlement-Actor',
  requestTimeoutMs: 30_000,
  bodyTimeoutMs: 5_000,
  bodyLimit: 2_048,
  responseMaxBytes: 32 * 1024 * 1024,
  httpOk: 200,
  maxWeeks: 6,
  maxNumberLength: 256,
  minimumApproximationSignificantDigits: 16,
  workbookContentType:
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;
export const SETTLEMENT_REPORT_ERROR_STATUS = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  DRAFT_STALE: 409,
  CONFIRMED: 409,
  POLICY_REQUIRED: 409,
  MONTH_OPEN: 409,
  FULL_MONTH_CONTRACT_REQUIRED: 409,
  PARTIAL_WEEK_POLICY_REQUIRED: 409,
  ADJUSTMENT_POLICY_REQUIRED: 409,
  NEGATIVE_NET_REQUIRES_POLICY: 409,
  SOURCE_MISMATCH: 409,
  SOURCE_LIMIT_EXCEEDED: 409,
  SOURCE_BUSY: 409,
} as const;
export type SettlementReportError = keyof typeof SETTLEMENT_REPORT_ERROR_STATUS;
export type SettlementReportResult<T> =
  { ok: true; data: T } | { ok: false; code: SettlementReportError };
export type SettlementReportMode = 'admin' | 'artist';
const id = z.uuid().toLowerCase();
const decimal = z
  .string()
  .max(SETTLEMENT_REPORTS.maxNumberLength)
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const integer = z
  .string()
  .max(SETTLEMENT_REPORTS.maxNumberLength)
  .regex(/^(?:0|[1-9]\d*)(?:\.0+)?$/);
const signedInteger = z
  .string()
  .max(SETTLEMENT_REPORTS.maxNumberLength)
  .regex(/^(?:0|-?[1-9]\d*)(?:\.0+)?$/);
const fraction = z.tuple([
  integer,
  integer.refine((value) => BigInt(value.split('.')[0]!) > 0n),
]);
export const settlementReportQuerySchema = z.strictObject({
  artistId: id,
  month: settlementMonthSchema,
});
export type SettlementReportQuery = z.output<
  typeof settlementReportQuerySchema
>;
export const settlementReportCalculateSchema =
  settlementReportQuerySchema.extend({ expectedRevision: id.nullable() });
export const settlementReportConfirmSchema = z.strictObject({
  reportId: id,
  expectedRevision: id,
});
export const settlementReportWeeklySchema = z.strictObject({
  weekStart: z.iso.date(),
  windowStart: z.iso.date(),
  windowEnd: z.iso.date(),
  messageCount: integer,
  photoCount: integer,
  messageRequired: decimal,
  photoRequired: decimal,
});
export const settlementReportSchema = z
  .strictObject({
    id,
    revision: id,
    status: z.enum(['draft', 'confirmed']),
    periodStart: settlementTimestampSchema,
    periodEnd: settlementTimestampSchema,
    currency: z.literal(SETTLEMENT_CALCULATION.currency),
    sourceVersion: integer,
    sourceEventCount: integer,
    sourceMessageCount: integer,
    grossKrw: integer,
    currentGrossKrw: signedInteger,
    adjustmentGrossKrw: signedInteger,
    vatKrw: decimal,
    pgFeeKrw: decimal,
    baseAmountKrw: decimal,
    rate: decimal,
    activityRatio: decimal,
    deductionKrw: decimal,
    unroundedFinalKrw: decimal,
    finalAmountKrw: integer,
    exactComponents: z.strictObject({
      vat: fraction,
      pg_fee: fraction,
      base: fraction,
      share: fraction,
      activity_ratio: fraction,
      deduction: fraction,
      final: fraction,
    }),
    policySnapshot: settlementCalculationPolicySchema,
    calculatedAt: settlementTimestampSchema,
    confirmedAt: settlementTimestampSchema.nullable(),
    weeklyStats: z
      .array(settlementReportWeeklySchema)
      .min(4)
      .max(SETTLEMENT_REPORTS.maxWeeks),
  })
  .refine(
    (report) =>
      (report.status === 'confirmed') === (report.confirmedAt !== null),
  );
export type SettlementReport = z.output<typeof settlementReportSchema>;
export const settlementReportEnvelopeSchema = z
  .strictObject({
    actorId: id,
    actorRole: z.enum(['admin', 'artist']),
    artist: z.strictObject({
      id,
      slug: z.string().min(1).max(100),
      name: z.string().min(1).max(200),
    }),
    month: settlementMonthSchema,
    report: settlementReportSchema.nullable(),
    sources: z
      .array(settlementCalculationEventSchema)
      .max(SETTLEMENT_CALCULATION.maxSourceRows)
      .nullable(),
  })
  .refine(
    (value) =>
      value.actorRole !== 'artist' ||
      (value.sources === null &&
        (value.report === null || value.report.status === 'confirmed')),
  );
export type SettlementReportEnvelope = z.output<
  typeof settlementReportEnvelopeSchema
>;
