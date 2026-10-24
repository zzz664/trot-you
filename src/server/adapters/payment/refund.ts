import 'server-only';
import { z } from 'zod';
import { SUPPORTED_PAYMENT_TAX_BASIS } from '@/config/billing-policy';
import { ENROLLMENT_MAX_AMOUNT_KRW } from '@/config/enrollment-provider';
import { REFUND_OPERATION_MARKER } from '@/config/refund-provider';
import { providerTransactionSchema, type EnrollmentResult } from './enrollment';

const positiveMoney = z
  .number()
  .int()
  .positive()
  .max(ENROLLMENT_MAX_AMOUNT_KRW);
export const refundInputSchema = z
  .strictObject({
    attemptId: z.uuid(),
    orderId: z.uuid(),
    customerRef: z.uuid(),
    providerPaymentId: providerTransactionSchema,
    originalProviderTransactionId: providerTransactionSchema,
    originalAmountKrw: positiveMoney,
    amountKrw: positiveMoney,
    refundedBeforeKrw: z
      .number()
      .int()
      .nonnegative()
      .max(ENROLLMENT_MAX_AMOUNT_KRW),
    currency: z.literal('KRW'),
    taxBasis: z.literal(SUPPORTED_PAYMENT_TAX_BASIS),
  })
  .refine(
    (input) =>
      input.refundedBeforeKrw + input.amountKrw <= input.originalAmountKrw,
  );

// All identities and pre-refund recognized money come from the locked DB
// snapshot. Neither an actor-supplied amount nor a current profile preference is
// authority to construct this input. Approval/eligibility stays in the service.
export type RefundInput = z.output<typeof refundInputSchema>;
export type VerifiedRefund = RefundInput & {
  providerTransactionId: string;
  refundedAt: string;
  cumulativeRefundedKrw: number;
  remainingKrw: number;
  merchantAccount: string;
};
export type RefundPaymentAdapter = {
  refund(input: RefundInput): Promise<EnrollmentResult<VerifiedRefund>>;
  query(input: RefundInput): Promise<EnrollmentResult<VerifiedRefund>>;
};
export function refundOperationMarker(attemptId: string) {
  return `${REFUND_OPERATION_MARKER}${attemptId}`;
}
export function refundTotals(input: RefundInput) {
  const cumulativeRefundedKrw = input.refundedBeforeKrw + input.amountKrw;
  return {
    cumulativeRefundedKrw,
    remainingKrw: input.originalAmountKrw - cumulativeRefundedKrw,
  };
}
