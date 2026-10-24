import { z } from 'zod';
import { ENROLLMENT_MAX_AMOUNT_KRW } from './enrollment-provider';

// Display/transport bounds only. This read-only screen cannot reset query
// budgets, authorize a payment or turn untrusted provider notices into revenue.
export const RECONCILIATION_ADMIN_LIMIT = 50;
export const RECONCILIATION_ADMIN_MAX_PAGE = 100_000;
export const RECONCILIATION_ADMIN_QUERY_LIMIT = 3;
export const RECONCILIATION_ADMIN_REASONS = [
  'PAYMENT_ID_MISSING',
  'CREDENTIAL_MISSING',
  'QUERY_BUDGET_EXHAUSTED',
  'OPERATION_NOT_QUERYABLE',
  'QUERY_UNCONFIRMED',
] as const;
export const reconciliationAdminPageSchema = z
  .union([
    z.number(),
    z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .transform(Number),
  ])
  .pipe(z.number().int().min(1).max(RECONCILIATION_ADMIN_MAX_PAGE));
export const reconciliationAdminCaseSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['initial', 'renewal', 'refund']),
  subscription_id: z.uuid(),
  provider: z.enum(['toss', 'kakaopay']),
  environment: z.enum(['test', 'live']),
  amount_krw: z.number().int().positive().max(ENROLLMENT_MAX_AMOUNT_KRW),
  status: z.enum([
    'pending',
    'processing',
    'retry',
    'processed',
    'manual_review',
  ]),
  reason: z.enum(RECONCILIATION_ADMIN_REASONS).nullable(),
  query_attempts: z.number().int().min(0).max(RECONCILIATION_ADMIN_QUERY_LIMIT),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});
export const reconciliationAdminListSchema = z
  .object({
    cases: z
      .array(reconciliationAdminCaseSchema)
      .max(RECONCILIATION_ADMIN_LIMIT),
    page: z.number().int().min(1).max(RECONCILIATION_ADMIN_MAX_PAGE),
    has_more: z.boolean(),
  })
  .refine(
    (value) =>
      new Set(value.cases.map((item) => item.id)).size === value.cases.length,
  );
export type ReconciliationAdminList = z.output<
  typeof reconciliationAdminListSchema
>;
export type ReconciliationAdminError =
  'INVALID_INPUT' | 'FORBIDDEN' | 'SETUP_NOT_READY' | 'UNAVAILABLE';
export type ReconciliationAdminResult<T> =
  { ok: true; data: T } | { ok: false; code: ReconciliationAdminError };
