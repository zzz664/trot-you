import 'server-only';
import { z } from 'zod';
import {
  BILLING_PERIOD_CALENDARS,
  SUPPORTED_PAYMENT_TAX_BASIS,
} from '@/config/billing-policy';
import {
  RENEWAL_PRIVATE_REASON_MAX_LENGTH,
  type RenewalResult,
} from '@/config/renewal';
import { paymentVaultEnvelopeSchema } from '@/server/adapters/payment/vault';
import type { VerifiedInitialCharge } from '@/server/adapters/payment/enrollment';

const instant = z.iso.datetime({ offset: true });
export const renewalSnapshotSchema = z.object({
  subscription_id: z.uuid(),
  user_id: z.uuid(),
  artist_id: z.uuid(),
  subscription_status: z.enum([
    'pending',
    'active',
    'grace',
    'canceled',
    'expired',
  ]),
  action: z.enum([
    'charge',
    'reconcile',
    'manual_review',
    'blocked',
    'none',
    'expired',
    'lease_expired',
  ]),
  reason: z.string().max(RENEWAL_PRIVATE_REASON_MAX_LENGTH).nullable(),
  dispatch: z.boolean(),
  mandate_id: z.uuid().nullable(),
  provider: z.enum(['toss', 'kakaopay']),
  environment: z.enum(['test', 'live']).nullable(),
  merchant_account: z.string().min(1).nullable(),
  customer_ref: z.uuid().nullable(),
  credential_ciphertext: paymentVaultEnvelopeSchema.nullable(),
  policy_version: z.uuid().nullable(),
  billing_period_calendar: z.enum(BILLING_PERIOD_CALENDARS).nullable(),
  payment_tax_basis: z.literal(SUPPORTED_PAYMENT_TAX_BASIS).nullable(),
  episode_started_at: instant.nullable(),
  amount_krw: z.number().int().positive().safe().nullable(),
  period_start: instant.nullable(),
  period_end: instant.nullable(),
  attempt_id: z.uuid().nullable(),
  attempt_state: z
    .enum(['created', 'inflight', 'success', 'failed', 'unknown'])
    .nullable(),
  provider_payment_id: z.string().min(1).nullable(),
  lease_token: z.uuid().nullable(),
});
export type RenewalSnapshot = z.output<typeof renewalSnapshotSchema>;
export const renewalAttemptSchema = z.object({
  attempt_id: z.uuid(),
  state: z.enum(['created', 'inflight', 'success', 'failed', 'unknown']),
  payment_event_id: z.uuid().nullable(),
});
export type RenewalDbPort = {
  candidates(limit: number): Promise<RenewalResult<string[]>>;
  read(subscriptionId: string): Promise<RenewalResult<RenewalSnapshot>>;
  claim(
    snapshot: RenewalSnapshot,
    leaseSeconds: number,
  ): Promise<RenewalResult<RenewalSnapshot>>;
  outcome(
    attemptId: string,
    lease: string,
    outcome: 'failed' | 'unknown',
    evidenceRef: string,
    retryable: boolean,
  ): Promise<RenewalResult<null>>;
  queryUnknown(attemptId: string, lease: string): Promise<RenewalResult<null>>;
  finalize(
    attemptId: string,
    charge: VerifiedInitialCharge,
    evidenceRef: string,
  ): Promise<RenewalResult<string>>;
  readAttempt(
    attemptId: string,
  ): Promise<RenewalResult<z.output<typeof renewalAttemptSchema>>>;
};
