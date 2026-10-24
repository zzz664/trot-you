import { z } from 'zod';

// Technical budgets only. No scheduler or new monetary operation is enabled.
export const RECONCILIATION_CANDIDATE_LIMIT = 4;
export const RECONCILIATION_LEASE_SECONDS = 180;
export const RECONCILIATION_BODY_TIMEOUT_MS = 1_000;
export const RECONCILIATION_RECEIPT_TIMEOUT_MS = 6_000;
export const RECONCILIATION_SECRET_MIN_LENGTH = 32;
export const RECONCILIATION_SECRET_MAX_LENGTH = 256;
export const RECONCILIATION_QUERY_LIMIT = 3;
export const RECONCILIATION_REASON_MAX_LENGTH = 128;
export const RECONCILIATION_HTTP_STATUS = {
  OK: 200,
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_EVENT: 422,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export const reconciliationSummarySchema = z.strictObject({
  examined: z.number().int().min(0).max(RECONCILIATION_CANDIDATE_LIMIT),
  queried: z.number().int().min(0).max(1),
  settled: z.number().int().min(0).max(1),
  unknown: z.number().int().min(0).max(1),
  manualReview: z.number().int().min(0).max(RECONCILIATION_CANDIDATE_LIMIT),
  skipped: z.number().int().min(0).max(RECONCILIATION_CANDIDATE_LIMIT),
});
export type ReconciliationSummary = z.output<
  typeof reconciliationSummarySchema
>;
export type ReconciliationResult<T> =
  { ok: true; data: T } | { ok: false; code: 'UNAVAILABLE' };
