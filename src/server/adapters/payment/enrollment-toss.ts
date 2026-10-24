import 'server-only';
import { z } from 'zod';
import type { ServerEnv } from '@/config/env.server';
import {
  ENROLLMENT_CHARGE_TIMEOUT_MS,
  ENROLLMENT_MERCHANT_MAX_LENGTH,
  ENROLLMENT_QUERY_TIMEOUT_MS,
  TOSS_API_ORIGIN,
  TOSS_DEFINITE_REJECTION_CODES,
  TOSS_CHARGE_PATH,
  TOSS_ISSUE_PATH,
  TOSS_ORDER_QUERY_PATH,
} from '@/config/enrollment-provider';
import { KAKAOPAY_REGISTRATION_ITEM_NAME } from '@/config/payment-preparation';
import { requireIntegrationConfiguration } from '@/server/configuration';
import {
  initialPaymentIdentitySchema,
  providerCredentialSchema,
  providerSecretSchema,
  providerTransactionSchema,
  type EnrollmentTransport,
  type InitialPaymentIdentity,
  type TossEnrollmentAdapter,
} from './enrollment';
import { enrollmentRequest } from './enrollment-http';
import { parsePreparationEnvironment, preparationFailure } from './preparation';

const exchangeSchema = z.strictObject({
  customerRef: z.uuid(),
  authKey: providerSecretSchema,
  idempotencyKey: z.uuid(),
});
const chargeSchema = initialPaymentIdentitySchema.extend({
  credential: providerCredentialSchema,
  idempotencyKey: z.uuid(),
});
const issueResponseSchema = z.object({
  mId: z.string().min(1).max(ENROLLMENT_MERCHANT_MAX_LENGTH),
  customerKey: z.uuid(),
  billingKey: providerCredentialSchema,
  method: z.literal('카드'),
  authenticatedAt: z.iso.datetime({ offset: true }),
});
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
// Only documented definitive refusals are classified as rejected. Unknown,
// duplicate and processing codes remain unknown even under a 4xx status.
function recognizedRejection(input: unknown) {
  const result = rejectionSchema.safeParse(input);
  return (
    result.success &&
    TOSS_DEFINITE_REJECTION_CODES.some((code) => code === result.data.code)
  );
}
function verifiedPayment(
  body: unknown,
  input: InitialPaymentIdentity,
  merchantAccount: string,
) {
  const result = paymentSchema.safeParse(body);
  if (
    !result.success ||
    result.data.mId !== merchantAccount ||
    result.data.orderId !== input.orderId ||
    result.data.totalAmount !== input.amountKrw ||
    result.data.balanceAmount !== input.amountKrw
  )
    return preparationFailure('OUTCOME_UNKNOWN');
  return {
    ok: true,
    data: {
      ...input,
      providerPaymentId: result.data.paymentKey,
      providerTransactionId: result.data.lastTransactionKey,
      approvedAt: new Date(result.data.approvedAt).toISOString(),
      currency: 'KRW',
      merchantAccount,
    },
  } as const;
}

// The trusted service must hold a durable, single-dispatch DB claim before
// calling exchange/charge. Each persisted UUID is reused for its SAME operation
// only. This adapter never retries and never rotates an idempotency key.
export function createTossEnrollmentAdapter(
  env: ServerEnv,
  transport: EnrollmentTransport = fetch,
): TossEnrollmentAdapter {
  const configuration = requireIntegrationConfiguration(
    'toss_card_billing',
    parsePreparationEnvironment(env),
  );
  const request = async (
    path: string,
    body: Record<string, unknown> | undefined,
    idempotencyKey?: string,
  ) => {
    if (!configuration.ok) return preparationFailure(configuration.error.code);
    const authorization = Buffer.from(
      `${configuration.data.credentials.TOSS_SECRET_KEY}:`,
      'utf8',
    ).toString('base64');
    return enrollmentRequest(transport, `${TOSS_API_ORIGIN}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Basic ${authorization}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body ? { body } : {}),
      timeoutMs: body
        ? ENROLLMENT_CHARGE_TIMEOUT_MS
        : ENROLLMENT_QUERY_TIMEOUT_MS,
      recognizedRejection,
      reconciliation: !body,
    });
  };
  return {
    async exchange(input) {
      if (!configuration.ok)
        return preparationFailure(configuration.error.code);
      const parsed = exchangeSchema.safeParse(input);
      if (!parsed.success) return preparationFailure('INVALID_INPUT');
      const result = await request(
        TOSS_ISSUE_PATH,
        { customerKey: parsed.data.customerRef, authKey: parsed.data.authKey },
        parsed.data.idempotencyKey,
      );
      if (!result.ok) return result;
      const issued = issueResponseSchema.safeParse(result.data);
      if (
        !issued.success ||
        issued.data.customerKey !== parsed.data.customerRef ||
        issued.data.mId !== configuration.data.credentials.TOSS_BILLING_MID
      )
        return preparationFailure('OUTCOME_UNKNOWN');
      return {
        ok: true,
        data: {
          credential: issued.data.billingKey,
          customerRef: parsed.data.customerRef,
          merchantAccount: issued.data.mId,
        },
      };
    },
    async charge(input) {
      if (!configuration.ok)
        return preparationFailure(configuration.error.code);
      const parsed = chargeSchema.safeParse(input);
      if (!parsed.success) return preparationFailure('INVALID_INPUT');
      const result = await request(
        `${TOSS_CHARGE_PATH}${encodeURIComponent(parsed.data.credential)}`,
        {
          customerKey: parsed.data.customerRef,
          amount: parsed.data.amountKrw,
          orderId: parsed.data.orderId,
          orderName: KAKAOPAY_REGISTRATION_ITEM_NAME,
          taxFreeAmount: 0,
        },
        parsed.data.idempotencyKey,
      );
      if (!result.ok) return result;
      // Project identity, never credential/idempotencyKey into settled facts.
      return verifiedPayment(
        result.data,
        {
          customerRef: parsed.data.customerRef,
          orderId: parsed.data.orderId,
          amountKrw: parsed.data.amountKrw,
        },
        configuration.data.credentials.TOSS_BILLING_MID,
      );
    },
    async query(input) {
      if (!configuration.ok)
        return preparationFailure(configuration.error.code);
      const parsed = initialPaymentIdentitySchema.safeParse(input);
      if (!parsed.success) return preparationFailure('INVALID_INPUT');
      const result = await request(
        `${TOSS_ORDER_QUERY_PATH}${encodeURIComponent(parsed.data.orderId)}`,
        undefined,
      );
      return result.ok
        ? verifiedPayment(
            result.data,
            parsed.data,
            configuration.data.credentials.TOSS_BILLING_MID,
          )
        : result;
    },
  };
}
