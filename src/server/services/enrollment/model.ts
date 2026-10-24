import 'server-only';
import { z } from 'zod';
import {
  BILLING_PERIOD_CALENDARS,
  SUPPORTED_PAYMENT_TAX_BASIS,
} from '@/config/billing-policy';
import { ENROLLMENT_HASH_PATTERN } from '@/config/enrollment-server';
import {
  enrollmentStatusSchema,
  type EnrollmentResult,
  type EnrollmentStatus,
} from '@/config/enrollment';
import type { PaymentVaultEnvelope } from '@/server/adapters/payment/vault';
import { paymentVaultEnvelopeSchema } from '@/server/adapters/payment/vault';
import type { VerifiedInitialCharge } from '@/server/adapters/payment/enrollment';

export const enrollmentActorSchema = z.strictObject({
  actorId: z.uuid(),
  authSessionHash: z.string().regex(ENROLLMENT_HASH_PATTERN),
  nonceHash: z.string().regex(ENROLLMENT_HASH_PATTERN),
});
export type EnrollmentActor = z.output<typeof enrollmentActorSchema>;
export const privateEnrollmentSchema = z.object({
  session_id: z.uuid(),
  user_id: z.uuid(),
  artist_id: z.uuid(),
  artist_slug: z.string(),
  artist_name: z.string(),
  provider: z.enum(['toss', 'kakaopay']),
  environment: z.enum(['test', 'live']),
  merchant_account: z.string().min(1),
  subscription_id: z.uuid(),
  mandate_id: z.uuid(),
  credential_ref: z.uuid(),
  customer_ref: z.uuid(),
  order_id: z.uuid(),
  policy_version: z.uuid(),
  billing_period_calendar: z.enum(BILLING_PERIOD_CALENDARS),
  payment_tax_basis: z.literal(SUPPORTED_PAYMENT_TAX_BASIS),
  policy_title: z.string(),
  policy_body: z.string(),
  initial_price_krw: z.number().int().positive(),
  regular_price_krw: z.number().int().positive(),
  intro_eligible: z.boolean(),
  expires_at: z.iso.datetime({ offset: true }),
  state: z.enum([
    'ready',
    'awaiting_authorization',
    'awaiting_confirmation',
    'processing',
    'succeeded',
    'failed',
    'canceled',
    'expired',
    'unknown',
    'manual_review',
  ]),
  stage: z.enum(['ready', 'exchange', 'charge', 'approve']).nullable(),
  public_status: enrollmentStatusSchema.shape.status,
  callback_ciphertext: paymentVaultEnvelopeSchema.nullable(),
  callback_expires_at: z.iso.datetime({ offset: true }).nullable(),
  credential_ciphertext: paymentVaultEnvelopeSchema.nullable(),
  tid: z.string().nullable(),
  redirects: paymentVaultEnvelopeSchema.nullable(),
  payment_event_id: z.uuid().nullable(),
  period_start: z.iso.datetime({ offset: true }).nullable(),
  period_end: z.iso.datetime({ offset: true }).nullable(),
  dispatch: z.boolean().optional(),
  lease_token: z.uuid().optional(),
});
export type PrivateEnrollment = z.output<typeof privateEnrollmentSchema>;
export type EnrollmentStage = NonNullable<PrivateEnrollment['stage']>;
export type EnrollmentDbPort = {
  start(
    actor: EnrollmentActor,
    sessionId: string,
    callbackStateHash: string,
    merchant: string,
  ): Promise<EnrollmentResult<PrivateEnrollment>>;
  read(
    actor: Pick<EnrollmentActor, 'actorId' | 'authSessionHash'>,
    sessionId: string,
  ): Promise<EnrollmentResult<PrivateEnrollment>>;
  capture(
    actor: EnrollmentActor,
    sessionId: string,
    callbackStateHash: string,
    ciphertext: PaymentVaultEnvelope,
  ): Promise<EnrollmentResult<PrivateEnrollment>>;
  claim(
    actor: EnrollmentActor,
    sessionId: string,
    stage: EnrollmentStage,
    consent?: {
      accepted: true;
      policyVersion: string;
      amountKrw: number;
      periodStart: string;
      periodEnd: string;
    },
  ): Promise<EnrollmentResult<PrivateEnrollment>>;
  recordReady(
    actorId: string,
    sessionId: string,
    lease: string,
    tid: string,
    redirects: PaymentVaultEnvelope,
  ): Promise<EnrollmentResult<PrivateEnrollment>>;
  recordCredential(
    actorId: string,
    sessionId: string,
    lease: string,
    credential: PaymentVaultEnvelope,
  ): Promise<EnrollmentResult<PrivateEnrollment>>;
  recordOutcome(
    actorId: string,
    sessionId: string,
    lease: string,
    outcome: 'failed' | 'unknown',
    evidenceRef: string,
  ): Promise<EnrollmentResult<PrivateEnrollment>>;
  finalize(
    actorId: string,
    sessionId: string,
    charge: VerifiedInitialCharge,
    evidenceRef: string,
    credential: PaymentVaultEnvelope | null,
  ): Promise<EnrollmentResult<PrivateEnrollment>>;
  recordReconciliation(
    actorId: string,
    sessionId: string,
    charge: VerifiedInitialCharge,
    evidenceRef: string,
  ): Promise<EnrollmentResult<PrivateEnrollment>>;
  cancel(
    actor: EnrollmentActor,
    sessionId: string,
  ): Promise<EnrollmentResult<PrivateEnrollment>>;
};

export function publicEnrollment(value: PrivateEnrollment): EnrollmentStatus {
  const status = value.public_status;
  return enrollmentStatusSchema.parse({
    sessionId: value.session_id,
    status,
    provider:
      value.provider === 'toss' ? 'toss_card_billing' : 'kakaopay_subscription',
    environment: value.environment,
    artist: { slug: value.artist_slug, name: value.artist_name },
    policy: {
      version: value.policy_version,
      title: value.policy_title,
      body: value.policy_body,
      billingPeriodCalendar: value.billing_period_calendar,
      paymentTaxBasis: value.payment_tax_basis,
    },
    amountKrw: value.initial_price_krw,
    regularPriceKrw: value.regular_price_krw,
    expiresAt:
      status === 'awaiting_confirmation' &&
      !value.credential_ciphertext &&
      value.callback_expires_at &&
      Date.parse(value.callback_expires_at) < Date.parse(value.expires_at)
        ? value.callback_expires_at
        : value.expires_at,
    canConfirm: status === 'awaiting_confirmation',
    canCancel: [
      'awaiting_authorization',
      'awaiting_confirmation',
      'expired',
    ].includes(status),
    canReconcile:
      status === 'unknown' &&
      (value.provider === 'toss'
        ? value.stage === 'charge'
        : value.stage === 'approve' && !!value.tid),
  });
}
