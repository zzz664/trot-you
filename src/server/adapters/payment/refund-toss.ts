import 'server-only';
import { z } from 'zod';
import type { ServerEnv } from '@/config/env.server';
import {
  ENROLLMENT_CHARGE_TIMEOUT_MS,
  ENROLLMENT_MAX_AMOUNT_KRW,
  ENROLLMENT_MAX_QUERY_ACTIONS,
  ENROLLMENT_MERCHANT_MAX_LENGTH,
  ENROLLMENT_QUERY_TIMEOUT_MS,
  TOSS_API_ORIGIN,
} from '@/config/enrollment-provider';
import { TOSS_REFUND_PATH, TOSS_REFUND_SUFFIX } from '@/config/refund-provider';
import { requireIntegrationConfiguration } from '@/server/configuration';
import {
  providerTransactionSchema,
  type EnrollmentTransport,
} from './enrollment';
import { enrollmentRequest } from './enrollment-http';
import { parsePreparationEnvironment, preparationFailure } from './preparation';
import {
  refundInputSchema,
  refundOperationMarker,
  refundTotals,
  type RefundInput,
  type RefundPaymentAdapter,
} from './refund';

const money = z.number().int().nonnegative().max(ENROLLMENT_MAX_AMOUNT_KRW);
const paymentSchema = z.object({
  mId: z.string().min(1).max(ENROLLMENT_MERCHANT_MAX_LENGTH),
  paymentKey: providerTransactionSchema,
  orderId: z.uuid(),
  type: z.literal('BILLING'),
  method: z.literal('카드'),
  currency: z.literal('KRW'),
  status: z.enum(['CANCELED', 'PARTIAL_CANCELED']),
  totalAmount: money,
  balanceAmount: money,
  taxFreeAmount: z.literal(0),
  taxExemptionAmount: z.literal(0),
  approvedAt: z.iso.datetime({ offset: true }),
  cancels: z
    .array(
      z.object({
        transactionKey: providerTransactionSchema,
        cancelReason: z.string(),
        cancelAmount: money,
        taxFreeAmount: z.literal(0),
        taxExemptionAmount: z.literal(0),
        refundableAmount: money,
        canceledAt: z.iso.datetime({ offset: true }),
        cancelStatus: z.literal('DONE'),
      }),
    )
    .min(1)
    .max(ENROLLMENT_MAX_QUERY_ACTIONS),
});

function verify(value: unknown, input: RefundInput, merchantAccount: string) {
  const parsed = paymentSchema.safeParse(value);
  if (!parsed.success) return preparationFailure('OUTCOME_UNKNOWN');
  const payment = parsed.data;
  const totals = refundTotals(input);
  const matches = payment.cancels.filter(
    (cancel) => cancel.cancelReason === refundOperationMarker(input.attemptId),
  );
  const action = matches[0];
  if (
    payment.mId !== merchantAccount ||
    payment.paymentKey !== input.providerPaymentId ||
    payment.orderId !== input.orderId ||
    payment.totalAmount !== input.originalAmountKrw ||
    payment.balanceAmount !== totals.remainingKrw ||
    payment.status !==
      (totals.remainingKrw === 0 ? 'CANCELED' : 'PARTIAL_CANCELED') ||
    matches.length !== 1 ||
    !action ||
    action.cancelAmount !== input.amountKrw ||
    action.refundableAmount !== totals.remainingKrw ||
    action.transactionKey === input.originalProviderTransactionId ||
    Date.parse(action.canceledAt) < Date.parse(payment.approvedAt) ||
    payment.cancels.some(
      (cancel) =>
        cancel.cancelAmount <= 0 ||
        Date.parse(cancel.canceledAt) < Date.parse(payment.approvedAt) ||
        Date.parse(cancel.canceledAt) > Date.parse(action.canceledAt),
    ) ||
    new Set(payment.cancels.map((cancel) => cancel.transactionKey)).size !==
      payment.cancels.length ||
    payment.cancels.reduce((sum, cancel) => sum + cancel.cancelAmount, 0) !==
      totals.cumulativeRefundedKrw
  )
    return preparationFailure('OUTCOME_UNKNOWN');
  return {
    ok: true as const,
    data: {
      ...input,
      providerTransactionId: action.transactionKey,
      refundedAt: new Date(action.canceledAt).toISOString(),
      ...totals,
      merchantAccount,
    },
  };
}

export function createTossRefundAdapter(
  env: ServerEnv,
  transport: EnrollmentTransport = fetch,
): RefundPaymentAdapter {
  const configuration = requireIntegrationConfiguration(
    'toss_card_billing',
    parsePreparationEnvironment(env),
  );
  async function execute(input: RefundInput, query: boolean) {
    if (!configuration.ok) return preparationFailure(configuration.error.code);
    const parsed = refundInputSchema.safeParse(input);
    if (!parsed.success) return preparationFailure('INVALID_INPUT');
    const { credentials } = configuration.data;
    const result = await enrollmentRequest(
      transport,
      `${TOSS_API_ORIGIN}${TOSS_REFUND_PATH}${encodeURIComponent(parsed.data.providerPaymentId)}${query ? '' : TOSS_REFUND_SUFFIX}`,
      {
        method: query ? 'GET' : 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${credentials.TOSS_SECRET_KEY}:`, 'utf8').toString('base64')}`,
          'Content-Type': 'application/json',
          ...(!query ? { 'Idempotency-Key': parsed.data.attemptId } : {}),
        },
        ...(!query
          ? {
              body: {
                cancelReason: refundOperationMarker(parsed.data.attemptId),
                cancelAmount: parsed.data.amountKrw,
                currency: parsed.data.currency,
                taxFreeAmount: 0,
                // Documented deprecated safety field: reject a stale provider balance.
                // Idempotency remains mandatory; this field is not a replacement.
                refundableAmount:
                  parsed.data.originalAmountKrw - parsed.data.refundedBeforeKrw,
              },
            }
          : {}),
        timeoutMs: query
          ? ENROLLMENT_QUERY_TIMEOUT_MS
          : ENROLLMENT_CHARGE_TIMEOUT_MS,
        // Cancellation errors can describe an already-canceled/processing
        // transaction. No HTTP error by itself proves this attempt had no effect.
        recognizedRejection: () => false,
        reconciliation: query,
      },
    );
    return result.ok
      ? verify(result.data, parsed.data, credentials.TOSS_BILLING_MID)
      : result;
  }
  return {
    refund: (input) => execute(input, false),
    query: (input) => execute(input, true),
  };
}
