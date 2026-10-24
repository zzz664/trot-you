import 'server-only';
import { z } from 'zod';
import type { ServerEnv } from '@/config/env.server';
import {
  ENROLLMENT_CHARGE_TIMEOUT_MS,
  ENROLLMENT_MERCHANT_MAX_LENGTH,
  TOSS_API_ORIGIN,
  TOSS_CHARGE_PATH,
  TOSS_DEFINITE_REJECTION_CODES,
} from '@/config/enrollment-provider';
import {
  RENEWAL_PROVIDER_ITEM_NAME,
  TOSS_RENEWAL_RETRYABLE_REJECTIONS,
} from '@/config/renewal-provider';
import { requireIntegrationConfiguration } from '@/server/configuration';
import {
  providerTransactionSchema,
  type EnrollmentTransport,
} from './enrollment';
import { createTossEnrollmentAdapter } from './enrollment-toss';
import { parsePreparationEnvironment, preparationFailure } from './preparation';
import {
  renewalChargeSchema,
  renewalQuerySchema,
  type RenewalPaymentAdapter,
} from './renewal';
import { renewalRequest } from './renewal-http';

const paymentSchema = z.object({
  mId: z.string().min(1).max(ENROLLMENT_MERCHANT_MAX_LENGTH),
  type: z.literal('BILLING'),
  orderId: z.uuid(),
  status: z.literal('DONE'),
  method: z.literal('카드'),
  currency: z.literal('KRW'),
  totalAmount: z.number().int().positive(),
  balanceAmount: z.number().int().positive(),
  taxFreeAmount: z.literal(0),
  taxExemptionAmount: z.literal(0),
  approvedAt: z.iso.datetime({ offset: true }),
  paymentKey: providerTransactionSchema,
  lastTransactionKey: providerTransactionSchema,
});
const rejectionSchema = z.object({
  code: z.string().min(1).max(ENROLLMENT_MERCHANT_MAX_LENGTH),
});

export function createTossRenewalAdapter(
  env: ServerEnv,
  transport: EnrollmentTransport = fetch,
): RenewalPaymentAdapter {
  const configuration = requireIntegrationConfiguration(
    'toss_card_billing',
    parsePreparationEnvironment(env),
  );
  const enrollment = createTossEnrollmentAdapter(env, transport);
  return {
    async charge(input) {
      if (!configuration.ok)
        return preparationFailure(configuration.error.code);
      const parsed = renewalChargeSchema.safeParse(input);
      if (!parsed.success) return preparationFailure('INVALID_INPUT');
      const { credentials } = configuration.data;
      const result = await renewalRequest(
        transport,
        `${TOSS_API_ORIGIN}${TOSS_CHARGE_PATH}${encodeURIComponent(parsed.data.credential)}`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${credentials.TOSS_SECRET_KEY}:`, 'utf8').toString('base64')}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': parsed.data.idempotencyKey,
          },
          body: {
            customerKey: parsed.data.customerRef,
            amount: parsed.data.amountKrw,
            orderId: parsed.data.orderId,
            orderName: RENEWAL_PROVIDER_ITEM_NAME,
            taxFreeAmount: 0,
          },
          timeoutMs: ENROLLMENT_CHARGE_TIMEOUT_MS,
          classifyRejection(body) {
            const rejected = rejectionSchema.safeParse(body);
            if (
              !rejected.success ||
              !TOSS_DEFINITE_REJECTION_CODES.some(
                (code) => code === rejected.data.code,
              )
            )
              return null;
            return TOSS_RENEWAL_RETRYABLE_REJECTIONS.some(
              (code) => code === rejected.data.code,
            )
              ? 'retryable'
              : 'customer_action';
          },
        },
      );
      if (!result.ok) return result;
      const payment = paymentSchema.safeParse(result.data);
      if (
        !payment.success ||
        payment.data.mId !== credentials.TOSS_BILLING_MID ||
        payment.data.orderId !== parsed.data.orderId ||
        payment.data.totalAmount !== parsed.data.amountKrw ||
        payment.data.balanceAmount !== parsed.data.amountKrw
      )
        return preparationFailure('OUTCOME_UNKNOWN');
      return {
        ok: true,
        data: {
          customerRef: parsed.data.customerRef,
          orderId: parsed.data.orderId,
          amountKrw: parsed.data.amountKrw,
          providerPaymentId: payment.data.paymentKey,
          providerTransactionId: payment.data.lastTransactionKey,
          approvedAt: new Date(payment.data.approvedAt).toISOString(),
          currency: 'KRW',
          merchantAccount: credentials.TOSS_BILLING_MID,
        },
      };
    },
    async query(input) {
      const parsed = renewalQuerySchema.safeParse(input);
      if (!parsed.success) return preparationFailure('INVALID_INPUT');
      // Order lookup is documented. Never re-charge or rotate the operation
      // key because of a timeout, processing response or even a 404 query.
      const result = await enrollment.query({
        customerRef: parsed.data.customerRef,
        orderId: parsed.data.orderId,
        amountKrw: parsed.data.amountKrw,
      });
      return result.ok &&
        parsed.data.providerPaymentId &&
        parsed.data.providerPaymentId !== result.data.providerPaymentId
        ? preparationFailure('OUTCOME_UNKNOWN')
        : result;
    },
  };
}
