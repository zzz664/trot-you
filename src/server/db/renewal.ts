import 'server-only';
import { z } from 'zod';
import type { CheckoutServiceClient } from './checkout-client';
import { RENEWAL_CANDIDATE_LIMIT, type RenewalResult } from '@/config/renewal';
import {
  renewalAttemptSchema,
  renewalSnapshotSchema,
  type RenewalDbPort,
} from '@/server/services/subscription/renewal-model';

function parsed<T>(
  schema: z.ZodType<T>,
  data: unknown,
  error: unknown,
): RenewalResult<T> {
  if (error) return { ok: false, code: 'UNAVAILABLE' };
  const result = schema.safeParse(data);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, code: 'UNAVAILABLE' };
}
const done = (error: unknown): RenewalResult<null> =>
  error ? { ok: false, code: 'UNAVAILABLE' } : { ok: true, data: null };

export function createRenewalDbPort(
  client: CheckoutServiceClient,
): RenewalDbPort {
  return {
    async candidates(limit) {
      const { data, error } = await client.rpc('renewal_candidates', {
        p_limit: limit,
      });
      return parsed(
        z.array(z.uuid()).max(RENEWAL_CANDIDATE_LIMIT),
        data,
        error,
      );
    },
    async read(subscriptionId) {
      const { data, error } = await client.rpc('renewal_read', {
        p_subscription_id: subscriptionId,
      });
      return parsed(renewalSnapshotSchema, data, error);
    },
    async claim(row, leaseSeconds) {
      const { data, error } = await client.rpc('renewal_claim', {
        p_subscription_id: row.subscription_id,
        ...(row.mandate_id ? { p_mandate_id: row.mandate_id } : {}),
        ...(row.period_start ? { p_period_start: row.period_start } : {}),
        ...(row.period_end ? { p_period_end: row.period_end } : {}),
        p_lease_seconds: leaseSeconds,
      });
      return parsed(renewalSnapshotSchema, data, error);
    },
    async outcome(attemptId, lease, outcome, evidence, retryable) {
      const { error } = await client.rpc('renewal_record_outcome', {
        p_attempt_id: attemptId,
        p_lease_token: lease,
        p_outcome: outcome,
        p_evidence_ref: evidence,
        p_retryable: retryable,
      });
      return done(error);
    },
    async queryUnknown(attemptId, lease) {
      const { error } = await client.rpc('renewal_record_query', {
        p_attempt_id: attemptId,
        p_lease_token: lease,
      });
      return done(error);
    },
    async finalize(attemptId, charge, evidence) {
      const { data, error } = await client.rpc('renewal_finalize', {
        p_attempt_id: attemptId,
        p_provider_action_id: charge.providerTransactionId,
        p_provider_payment_id: charge.providerPaymentId,
        p_amount_krw: charge.amountKrw,
        p_currency: charge.currency,
        p_approved_at: charge.approvedAt,
        p_evidence_ref: evidence,
      });
      return parsed(z.uuid(), data, error);
    },
    async readAttempt(attemptId) {
      const { data, error } = await client.rpc('renewal_read_attempt', {
        p_attempt_id: attemptId,
      });
      return parsed(renewalAttemptSchema, data, error);
    },
  };
}
