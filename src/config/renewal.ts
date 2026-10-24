import { z } from 'zod';

// Technical execution limits, not prices, retry, grace or notice policy defaults.
// Four preflight reads and one provider invocation keep the 300s route budget
// finite even when every 15s DB deadline is exhausted. Never loop until empty.
export const RENEWAL_CANDIDATE_LIMIT = 4;
export const RENEWAL_BODY_TIMEOUT_MS = 1_000;
export const RENEWAL_PRIVATE_REASON_MAX_LENGTH = 128;
export const RENEWAL_LEASE_SECONDS = 180;
export const RENEWAL_CRON_SECRET_MIN_LENGTH = 32;
export const RENEWAL_CRON_SECRET_MAX_LENGTH = 256;
export const RENEWAL_HTTP_STATUS = {
  OK: 200,
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export const renewalSummarySchema = z.strictObject({
  examined: z.number().int().nonnegative().max(RENEWAL_CANDIDATE_LIMIT),
  dispatched: z.number().int().min(0).max(1),
  settled: z.number().int().min(0).max(1),
  declined: z.number().int().min(0).max(1),
  unknown: z.number().int().min(0).max(1),
  manualReview: z.number().int().nonnegative().max(RENEWAL_CANDIDATE_LIMIT),
  expired: z.number().int().nonnegative().max(RENEWAL_CANDIDATE_LIMIT),
  skipped: z.number().int().nonnegative().max(RENEWAL_CANDIDATE_LIMIT),
});
export type RenewalSummary = z.output<typeof renewalSummarySchema>;
export type RenewalResult<T> =
  { ok: true; data: T } | { ok: false; code: 'UNAVAILABLE' };
