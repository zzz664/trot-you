import 'server-only';
import type { CheckoutServiceClient } from './checkout-client';
import type { CheckoutError, CheckoutResult } from '@/config/checkout';
import {
  privateEnrollmentSchema,
  type EnrollmentDbPort,
  type PrivateEnrollment,
} from '@/server/services/enrollment/model';

const errors: Record<string, CheckoutError> = {
  ENROLLMENT_INVALID_INPUT: 'INVALID_INPUT',
  ENROLLMENT_NOT_FOUND: 'NOT_FOUND',
  ENROLLMENT_BINDING_INVALID: 'FORBIDDEN',
  ENROLLMENT_AUTHORIZATION_EXPIRED: 'SESSION_EXPIRED',
  ENROLLMENT_INVALID_PERIOD: 'INVALID_INPUT',
  ENROLLMENT_NOT_READY: 'SESSION_CONSUMED',
  ENROLLMENT_OUTCOME_CONFLICT: 'SESSION_CONSUMED',
  ENROLLMENT_CREDENTIAL_REQUIRED: 'COMPLETION_UNAVAILABLE',
  ENROLLMENT_CANNOT_CANCEL: 'SESSION_CONSUMED',
  CHECKOUT_INVALID_INPUT: 'INVALID_INPUT',
  CHECKOUT_CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  CHECKOUT_POLICY_CHANGED: 'POLICY_CHANGED',
  CHECKOUT_SETUP_NOT_READY: 'SETUP_NOT_READY',
  CHECKOUT_NOT_FOUND: 'NOT_FOUND',
  CHECKOUT_NONCE_INVALID: 'FORBIDDEN',
  CHECKOUT_SESSION_EXPIRED: 'SESSION_EXPIRED',
  CHECKOUT_SESSION_REPLAY: 'SESSION_CONSUMED',
  CHECKOUT_SESSION_EXISTS: 'CHECKOUT_EXISTS',
  CHECKOUT_SUBSCRIPTION_EXISTS: 'SUBSCRIPTION_EXISTS',
  CHECKOUT_ONBOARDING_REQUIRED: 'FORBIDDEN',
  CHECKOUT_PROFILE_REQUIRED: 'FORBIDDEN',
  DISCOVERY_FORBIDDEN: 'FORBIDDEN',
  DISCOVERY_PROFILE_REQUIRED: 'FORBIDDEN',
  DISCOVERY_SETUP_NOT_READY: 'SETUP_NOT_READY',
};
function result(
  data: unknown,
  error: { message: string } | null,
): CheckoutResult<PrivateEnrollment> {
  if (error)
    return {
      ok: false,
      code: Object.hasOwn(errors, error.message)
        ? errors[error.message]!
        : 'UNAVAILABLE',
    };
  const parsed = privateEnrollmentSchema.safeParse(data);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, code: 'UNAVAILABLE' };
}

export function createEnrollmentDbPort(
  client: CheckoutServiceClient,
): EnrollmentDbPort {
  return {
    async start(actor, sessionId, callbackStateHash, merchant) {
      const { data, error } = await client.rpc('enrollment_start', {
        p_user_id: actor.actorId,
        p_session_id: sessionId,
        p_nonce_hash: actor.nonceHash,
        p_auth_session_hash: actor.authSessionHash,
        p_callback_state_hash: callbackStateHash,
        p_merchant_account: merchant,
      });
      return result(data, error);
    },
    async read(actor, sessionId) {
      const { data, error } = await client.rpc('enrollment_read', {
        p_user_id: actor.actorId,
        p_session_id: sessionId,
        p_auth_session_hash: actor.authSessionHash,
        ...('nonceHash' in actor && typeof actor.nonceHash === 'string'
          ? { p_nonce_hash: actor.nonceHash }
          : {}),
      });
      return result(data, error);
    },
    async capture(actor, sessionId, stateHash, ciphertext) {
      const { data, error } = await client.rpc('enrollment_capture', {
        p_user_id: actor.actorId,
        p_session_id: sessionId,
        p_nonce_hash: actor.nonceHash,
        p_auth_session_hash: actor.authSessionHash,
        p_callback_state_hash: stateHash,
        p_callback_ciphertext: ciphertext,
      });
      return result(data, error);
    },
    async claim(actor, sessionId, stage, consent) {
      const { data, error } = await client.rpc('enrollment_claim', {
        p_user_id: actor.actorId,
        p_session_id: sessionId,
        p_nonce_hash: actor.nonceHash,
        p_auth_session_hash: actor.authSessionHash,
        p_stage: stage,
        ...(consent
          ? {
              p_accepted: consent.accepted,
              p_policy_version: consent.policyVersion,
              p_amount_krw: consent.amountKrw,
              p_period_start: consent.periodStart,
              p_period_end: consent.periodEnd,
            }
          : {}),
      });
      return result(data, error);
    },
    async recordReady(actorId, sessionId, lease, tid, redirects) {
      const { data, error } = await client.rpc('enrollment_record_ready', {
        p_user_id: actorId,
        p_session_id: sessionId,
        p_lease_token: lease,
        p_tid: tid,
        p_redirects: redirects,
      });
      return result(data, error);
    },
    async recordCredential(actorId, sessionId, lease, credential) {
      const { data, error } = await client.rpc('enrollment_record_credential', {
        p_user_id: actorId,
        p_session_id: sessionId,
        p_lease_token: lease,
        p_credential_ciphertext: credential,
      });
      return result(data, error);
    },
    async recordOutcome(actorId, sessionId, lease, outcome, evidenceRef) {
      const { data, error } = await client.rpc('enrollment_record_outcome', {
        p_user_id: actorId,
        p_session_id: sessionId,
        p_lease_token: lease,
        p_outcome: outcome,
        p_evidence_ref: evidenceRef,
      });
      return result(data, error);
    },
    async finalize(actorId, sessionId, charge, evidenceRef, credential) {
      const { data, error } = await client.rpc('enrollment_finalize', {
        p_user_id: actorId,
        p_session_id: sessionId,
        p_provider_action_id: charge.providerTransactionId,
        p_provider_payment_id: charge.providerPaymentId,
        p_amount_krw: charge.amountKrw,
        p_currency: charge.currency,
        p_approved_at: charge.approvedAt,
        p_evidence_ref: evidenceRef,
        ...(credential ? { p_credential_ciphertext: credential } : {}),
      });
      return result(data, error);
    },
    async recordReconciliation(actorId, sessionId, charge, evidenceRef) {
      const { data, error } = await client.rpc(
        'enrollment_record_reconciliation',
        {
          p_user_id: actorId,
          p_session_id: sessionId,
          p_provider_action_id: charge.providerTransactionId,
          p_provider_payment_id: charge.providerPaymentId,
          p_amount_krw: charge.amountKrw,
          p_currency: charge.currency,
          p_approved_at: charge.approvedAt,
          p_evidence_ref: evidenceRef,
        },
      );
      return result(data, error);
    },
    async cancel(actor, sessionId) {
      const { data, error } = await client.rpc('enrollment_cancel', {
        p_user_id: actor.actorId,
        p_session_id: sessionId,
        p_nonce_hash: actor.nonceHash,
        p_auth_session_hash: actor.authSessionHash,
      });
      return result(data, error);
    },
  };
}
