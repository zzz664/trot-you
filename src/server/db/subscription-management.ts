import 'server-only';
import { z } from 'zod';
import {
  MANAGEMENT_ADMIN_LIMIT,
  adminRefundListSchema,
  adminRefundRecordSchema,
  refundRequestSchema,
  subscriptionDetailSchema,
  subscriptionListSchema,
  type ManagementResult,
} from '@/config/subscription-management';
import type { ActorClient } from './client';
import type { CheckoutServiceClient } from './checkout-client';
import {
  refundSnapshotSchema,
  type ManagementDbPort,
  type RefundDbPort,
} from '@/server/services/subscription/management-model';

const errors = {
  FORBIDDEN: 'FORBIDDEN',
  REFUND_INVALID_INPUT: 'INVALID_INPUT',
  REFUND_NOT_FOUND: 'NOT_FOUND',
  REFUND_IDEMPOTENCY_CONFLICT: 'CONFLICT',
  REFUND_CHARGE_UNVERIFIED: 'CONFLICT',
  REFUND_EXCEEDS_CHARGE: 'CONFLICT',
  REFUND_ALREADY_OPEN: 'CONFLICT',
  REFUND_STATE_CONFLICT: 'CONFLICT',
  REFUND_POLICY_NOT_APPROVED: 'POLICY_NOT_APPROVED',
  REFUND_AMOUNT_MISMATCH: 'CONFLICT',
  REFUND_OUTCOME_CONFLICT: 'CONFLICT',
  REFUND_RESULT_MISMATCH: 'CONFLICT',
} as const;
function failure(error: unknown): ManagementResult<never> {
  const parsed = z.object({ message: z.string() }).safeParse(error);
  const key = parsed.success ? parsed.data.message : '';
  return {
    ok: false,
    code: Object.hasOwn(errors, key)
      ? errors[key as keyof typeof errors]
      : 'UNAVAILABLE',
  };
}
function parsed<T>(
  schema: z.ZodType<T>,
  data: unknown,
  error: unknown,
): ManagementResult<T> {
  if (error) return failure(error);
  const result = schema.safeParse(data);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, code: 'UNAVAILABLE' };
}
export function createManagementDbPort(client: ActorClient): ManagementDbPort {
  return {
    async list(page) {
      const { data, error } = await client.rpc('subscription_management_list', {
        p_page: page,
      });
      return parsed(subscriptionListSchema, data, error);
    },
    async read(id, page) {
      const { data, error } = await client.rpc('subscription_management_read', {
        p_subscription_id: id,
        p_page: page,
      });
      return parsed(subscriptionDetailSchema, data, error);
    },
    async cancel(id) {
      const { error } = await client.rpc('cancel_subscription', {
        p_subscription_id: id,
      });
      return error ? failure(error) : { ok: true, data: null };
    },
    async request(input) {
      const { data, error } = await client.rpc('refund_request', {
        p_subscription_id: input.subscriptionId,
        p_original_event_id: input.originalEventId,
        p_amount_krw: input.amountKrw,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
      });
      return parsed(refundRequestSchema, data, error);
    },
    async adminList(page) {
      const { data, error } = await client.rpc('refund_admin_list', {
        p_limit: MANAGEMENT_ADMIN_LIMIT,
        p_page: page,
      });
      return parsed(adminRefundListSchema, data, error);
    },
    async adminRead(id) {
      const { data, error } = await client.rpc('refund_admin_read', {
        p_request_id: id,
      });
      return parsed(adminRefundRecordSchema, data, error);
    },
    async authorize(input) {
      const { data, error } = await client.rpc('refund_decide', {
        p_request_id: input.requestId,
        p_decision: 'approve',
        p_amount_krw: input.amountKrw,
        p_policy_version: input.policyVersion,
        p_reason: input.reason,
      });
      return parsed(refundRequestSchema, data, error);
    },
    async reject(input) {
      const { data, error } = await client.rpc('refund_decide', {
        p_request_id: input.requestId,
        p_decision: 'reject',
        p_reason: input.reason,
      });
      return parsed(refundRequestSchema, data, error);
    },
  };
}
export function createRefundDbPort(
  client: CheckoutServiceClient,
): RefundDbPort {
  return {
    async read(id) {
      const { data, error } = await client.rpc('refund_read', {
        p_request_id: id,
      });
      return parsed(refundSnapshotSchema, data, error);
    },
    async claim(id, actorId, leaseSeconds) {
      const { data, error } = await client.rpc('refund_claim', {
        p_request_id: id,
        p_actor_id: actorId,
        p_lease_seconds: leaseSeconds,
      });
      return parsed(refundSnapshotSchema, data, error);
    },
    async outcome(id, lease, outcome, evidence) {
      const { data, error } = await client.rpc('refund_record_outcome', {
        p_request_id: id,
        p_lease_token: lease,
        p_outcome: outcome,
        p_evidence_ref: evidence,
      });
      return parsed(refundSnapshotSchema, data, error);
    },
    async finalize(id, refund, evidence) {
      const { data, error } = await client.rpc('refund_finalize', {
        p_request_id: id,
        p_provider_action_id: refund.providerTransactionId,
        p_provider_payment_id: refund.providerPaymentId,
        p_amount_krw: refund.amountKrw,
        p_currency: refund.currency,
        p_refunded_at: refund.refundedAt,
        p_evidence_ref: evidence,
      });
      return parsed(z.uuid(), data, error);
    },
  };
}
