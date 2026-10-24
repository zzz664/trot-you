import 'server-only';
import { z } from 'zod';
import {
  initialPaymentIdentitySchema,
  providerCredentialSchema,
  providerTransactionSchema,
  type EnrollmentResult,
  type VerifiedInitialCharge,
} from './enrollment';

export const renewalChargeSchema = initialPaymentIdentitySchema.extend({
  credential: providerCredentialSchema,
  // A durable local attempt identity for BOTH providers. Kakao does not accept
  // an idempotency header: only the database claim prevents a second dispatch.
  idempotencyKey: z.uuid(),
});
export const renewalQuerySchema = initialPaymentIdentitySchema.extend({
  providerPaymentId: providerTransactionSchema.optional(),
});
export type RenewalChargeInput = z.output<typeof renewalChargeSchema>;
export type RenewalQueryInput = z.output<typeof renewalQuerySchema>;
export type RenewalFailureDisposition = 'retryable' | 'customer_action';
export type RenewalPaymentResult =
  | Extract<EnrollmentResult<VerifiedInitialCharge>, { ok: true }>
  | (Extract<EnrollmentResult<never>, { ok: false }> & {
      failureDisposition?: RenewalFailureDisposition;
    });
export type RenewalPaymentAdapter = {
  charge(input: RenewalChargeInput): Promise<RenewalPaymentResult>;
  query(input: RenewalQueryInput): Promise<RenewalPaymentResult>;
};
