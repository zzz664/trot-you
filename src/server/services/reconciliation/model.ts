import 'server-only';
import { z } from 'zod';
import {
  RECONCILIATION_QUERY_LIMIT,
  RECONCILIATION_REASON_MAX_LENGTH,
  type ReconciliationResult,
} from '@/config/reconciliation';
import {
  ENROLLMENT_MAX_AMOUNT_KRW,
  ENROLLMENT_MERCHANT_MAX_LENGTH,
} from '@/config/enrollment-provider';
import { providerTransactionSchema } from '@/server/adapters/payment/enrollment';

const money = z.number().int().positive().max(ENROLLMENT_MAX_AMOUNT_KRW);
const instant = z.iso.datetime({ offset: true });
// No credential, callback token, full provider response or user PII is needed
// to recover an already dispatched operation through an authenticated query.
export const reconciliationSnapshotSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(['initial', 'renewal', 'refund']),
  target_id: z.uuid(),
  subscription_id: z.uuid(),
  provider: z.enum(['toss', 'kakaopay']),
  environment: z.enum(['test', 'live']),
  merchant_account: z.string().min(1).max(ENROLLMENT_MERCHANT_MAX_LENGTH),
  customer_ref: z.uuid(),
  order_id: z.uuid(),
  amount_krw: money,
  currency: z.literal('KRW'),
  provider_payment_id: providerTransactionSchema.nullable(),
  provider_charge_action_id: providerTransactionSchema.nullable(),
  original_amount_krw: money.nullable(),
  refunded_before_krw: z
    .number()
    .int()
    .min(0)
    .max(ENROLLMENT_MAX_AMOUNT_KRW)
    .nullable(),
  tax_basis: z.literal('taxable_krw'),
  authorized_at: instant.nullable(),
  operation_started_at: instant,
  state: z.enum([
    'pending',
    'processing',
    'retry',
    'processed',
    'manual_review',
  ]),
  reason: z.string().max(RECONCILIATION_REASON_MAX_LENGTH).nullable(),
  dispatch: z.boolean(),
  lease_token: z.uuid().nullable(),
  query_attempts: z.number().int().min(0).max(RECONCILIATION_QUERY_LIMIT),
  payment_event_id: z.uuid().nullable(),
});
export type ReconciliationSnapshot = z.output<
  typeof reconciliationSnapshotSchema
>;
export type ReconciledPayment = {
  providerTransactionId: string;
  providerPaymentId: string;
  amountKrw: number;
  currency: 'KRW';
  occurredAt: string;
};
export type ReconciliationDbPort = {
  candidates(limit: number): Promise<ReconciliationResult<string[]>>;
  read(caseId: string): Promise<ReconciliationResult<ReconciliationSnapshot>>;
  claim(
    caseId: string,
    leaseSeconds: number,
  ): Promise<ReconciliationResult<ReconciliationSnapshot>>;
  complete(
    caseId: string,
    lease: string,
    payment: ReconciledPayment,
    evidence: string,
  ): Promise<ReconciliationResult<ReconciliationSnapshot>>;
  defer(
    caseId: string,
    lease: string,
  ): Promise<ReconciliationResult<ReconciliationSnapshot>>;
};
