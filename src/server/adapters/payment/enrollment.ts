import 'server-only';
import { z } from 'zod';
import {
  ENROLLMENT_CREDENTIAL_MAX_LENGTH,
  ENROLLMENT_MAX_AMOUNT_KRW,
  ENROLLMENT_PROVIDER_TOKEN_MAX_LENGTH,
  ENROLLMENT_TRANSACTION_MAX_LENGTH,
} from '@/config/enrollment-provider';
import type { PreparationIdentity, PreparationResult } from './preparation';

export type EnrollmentTransport = (
  input: string,
  init: RequestInit,
) => Promise<Response>;
export type EnrollmentResult<T> = PreparationResult<T>;
export type InitialPaymentIdentity = {
  customerRef: string;
  orderId: string;
  amountKrw: number;
};
// Server-only verified facts, never a raw provider response. The opaque customer
// reference is bound by issuance/ready and the immutable local order identity.
export type VerifiedInitialCharge = InitialPaymentIdentity & {
  providerPaymentId: string;
  providerTransactionId: string;
  approvedAt: string;
  currency: 'KRW';
  merchantAccount: string;
};
export type IssuedTossCredential = {
  credential: string;
  customerRef: string;
  merchantAccount: string;
};
export type KakaoReadyResult = {
  tid: string;
  redirects: { mobile: string; desktop: string };
};
export type KakaoApprovalResult = {
  credential: string;
  charge: VerifiedInitialCharge;
};
export type TossEnrollmentAdapter = {
  exchange(input: {
    customerRef: string;
    authKey: string;
    idempotencyKey: string;
  }): Promise<EnrollmentResult<IssuedTossCredential>>;
  charge(
    input: InitialPaymentIdentity & {
      credential: string;
      idempotencyKey: string;
    },
  ): Promise<EnrollmentResult<VerifiedInitialCharge>>;
  query(
    input: InitialPaymentIdentity,
  ): Promise<EnrollmentResult<VerifiedInitialCharge>>;
};
export type KakaoEnrollmentAdapter = {
  ready(
    input: PreparationIdentity & { amountKrw: number },
  ): Promise<EnrollmentResult<KakaoReadyResult>>;
  approve(
    input: InitialPaymentIdentity & { tid: string; pgToken: string },
  ): Promise<EnrollmentResult<KakaoApprovalResult>>;
  query(
    input: InitialPaymentIdentity & { tid: string },
  ): Promise<EnrollmentResult<VerifiedInitialCharge>>;
};

export const providerSecretSchema = z
  .string()
  .min(1)
  .max(ENROLLMENT_PROVIDER_TOKEN_MAX_LENGTH)
  .regex(/^[\x21-\x7e]+$/);
export const providerCredentialSchema = providerSecretSchema.max(
  ENROLLMENT_CREDENTIAL_MAX_LENGTH,
);
export const providerTransactionSchema = z
  .string()
  .min(1)
  .max(ENROLLMENT_TRANSACTION_MAX_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/);
export const initialPaymentIdentitySchema = z.strictObject({
  customerRef: z.uuid(),
  orderId: z.uuid(),
  amountKrw: z.number().int().positive().max(ENROLLMENT_MAX_AMOUNT_KRW),
});
