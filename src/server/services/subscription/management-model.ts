import 'server-only';
import { z } from 'zod';
import type {
  AdminRefundList,
  AdminRefundRecord,
  ManagementResult,
  RefundAuthorizeInput,
  RefundRejectInput,
  RefundRequest,
  RefundRequestInput,
  SubscriptionDetail,
  SubscriptionList,
} from '@/config/subscription-management';
import { MANAGEMENT_REASON_MAX_LENGTH } from '@/config/subscription-management';
import { providerTransactionSchema } from '@/server/adapters/payment/enrollment';
import type { VerifiedRefund } from '@/server/adapters/payment/refund';

export type ManagementDbPort = {
  list(page: number): Promise<ManagementResult<SubscriptionList>>;
  read(id: string, page: number): Promise<ManagementResult<SubscriptionDetail>>;
  cancel(id: string): Promise<ManagementResult<null>>;
  request(input: RefundRequestInput): Promise<ManagementResult<RefundRequest>>;
  adminList(page: number): Promise<ManagementResult<AdminRefundList>>;
  adminRead(id: string): Promise<ManagementResult<AdminRefundRecord>>;
  authorize(
    input: RefundAuthorizeInput,
  ): Promise<ManagementResult<RefundRequest>>;
  reject(input: RefundRejectInput): Promise<ManagementResult<RefundRequest>>;
};
const instant = z.iso.datetime({ offset: true });
export const refundSnapshotSchema = z.object({
  request_id: z.uuid(),
  subscription_id: z.uuid(),
  user_id: z.uuid(),
  original_event_id: z.uuid(),
  state: z.enum([
    'requested',
    'authorized',
    'inflight',
    'unknown',
    'succeeded',
    'failed',
    'rejected',
  ]),
  amount_krw: z.number().int().positive().safe(),
  currency: z.literal('KRW'),
  provider: z.enum(['toss', 'kakaopay']),
  environment: z.enum(['test', 'live']),
  merchant_account: z.string().min(1),
  customer_ref: z.uuid().nullable(),
  order_id: z.uuid().nullable(),
  provider_payment_id: providerTransactionSchema.nullable(),
  provider_charge_action_id: providerTransactionSchema,
  charge_amount_krw: z.number().int().positive().safe(),
  refunded_before_krw: z.number().int().nonnegative().safe().nullable(),
  policy_version: z.uuid().nullable(),
  payment_tax_basis: z.literal('taxable_krw').nullable(),
  requested_at: instant,
  authorized_at: instant.nullable(),
  action: z.enum([
    'none',
    'refund',
    'lease_expired',
    'reconcile',
    'manual_review',
    'blocked',
  ]),
  reason: z.string().max(MANAGEMENT_REASON_MAX_LENGTH).nullable(),
  dispatch: z.boolean(),
  lease_token: z.uuid().nullable(),
  payment_event_id: z.uuid().nullable(),
});
export type RefundSnapshot = z.output<typeof refundSnapshotSchema>;
export type RefundDbPort = {
  read(requestId: string): Promise<ManagementResult<RefundSnapshot>>;
  claim(
    requestId: string,
    actorId: string,
    leaseSeconds: number,
  ): Promise<ManagementResult<RefundSnapshot>>;
  outcome(
    requestId: string,
    lease: string,
    outcome: 'failed' | 'unknown',
    evidenceRef: string,
  ): Promise<ManagementResult<RefundSnapshot>>;
  finalize(
    requestId: string,
    refund: VerifiedRefund,
    evidenceRef: string,
  ): Promise<ManagementResult<string>>;
};
