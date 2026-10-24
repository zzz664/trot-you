import 'server-only';
import { z } from 'zod';
import {
  RECONCILIATION_CANDIDATE_LIMIT,
  type ReconciliationResult,
} from '@/config/reconciliation';
import type { CheckoutServiceClient } from './checkout-client';
import {
  reconciliationSnapshotSchema,
  type ReconciliationDbPort,
} from '@/server/services/reconciliation/model';

function parsed<T>(
  schema: z.ZodType<T>,
  data: unknown,
  error: unknown,
): ReconciliationResult<T> {
  if (error) return { ok: false, code: 'UNAVAILABLE' };
  const result = schema.safeParse(data);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, code: 'UNAVAILABLE' };
}
export function createReconciliationDbPort(
  client: CheckoutServiceClient,
): ReconciliationDbPort {
  return {
    async candidates(limit) {
      const { data, error } = await client.rpc('reconciliation_candidates', {
        p_limit: limit,
      });
      return parsed(
        z.array(z.uuid()).max(RECONCILIATION_CANDIDATE_LIMIT),
        data,
        error,
      );
    },
    async read(caseId) {
      const { data, error } = await client.rpc('reconciliation_read', {
        p_case_id: caseId,
      });
      return parsed(reconciliationSnapshotSchema, data, error);
    },
    async claim(caseId, leaseSeconds) {
      const { data, error } = await client.rpc('reconciliation_claim', {
        p_case_id: caseId,
        p_lease_seconds: leaseSeconds,
      });
      return parsed(reconciliationSnapshotSchema, data, error);
    },
    async complete(caseId, lease, payment, evidence) {
      const { data, error } = await client.rpc('reconciliation_complete', {
        p_case_id: caseId,
        p_lease_token: lease,
        p_provider_action_id: payment.providerTransactionId,
        p_provider_payment_id: payment.providerPaymentId,
        p_amount_krw: payment.amountKrw,
        p_currency: payment.currency,
        p_occurred_at: payment.occurredAt,
        p_evidence_ref: evidence,
      });
      return parsed(reconciliationSnapshotSchema, data, error);
    },
    async defer(caseId, lease) {
      const { data, error } = await client.rpc('reconciliation_defer', {
        p_case_id: caseId,
        p_lease_token: lease,
      });
      return parsed(reconciliationSnapshotSchema, data, error);
    },
  };
}

export function createEnrollmentReconciliationCasePort(
  client: CheckoutServiceClient,
) {
  return {
    async enrollmentCase(actorId: string, sessionId: string) {
      const { data, error } = await client.rpc(
        'reconciliation_enrollment_case',
        { p_user_id: actorId, p_session_id: sessionId },
      );
      return parsed(z.uuid(), data, error);
    },
  };
}
