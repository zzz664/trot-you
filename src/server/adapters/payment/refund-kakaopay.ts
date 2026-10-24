import 'server-only';
import { z } from 'zod';
import type { ServerEnv } from '@/config/env.server';
import {
  ENROLLMENT_CHARGE_TIMEOUT_MS,
  ENROLLMENT_MAX_AMOUNT_KRW,
  ENROLLMENT_MAX_QUERY_ACTIONS,
  ENROLLMENT_MERCHANT_MAX_LENGTH,
  ENROLLMENT_QUERY_TIMEOUT_MS,
  KAKAOPAY_DATETIME_OFFSET,
  KAKAOPAY_ORDER_URL,
} from '@/config/enrollment-provider';
import { KAKAOPAY_REFUND_URL } from '@/config/refund-provider';
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
const datetime = z
  .string()
  .transform((value) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)
      ? `${value}${KAKAOPAY_DATETIME_OFFSET}`
      : value,
  )
  .pipe(z.iso.datetime({ offset: true }))
  .transform((value) => new Date(value).toISOString());
const amount = z.object({
  total: money,
  tax_free: z.literal(0),
  green_deposit: z.literal(0).optional(),
});
const paymentSchema = z.object({
  cid: z.string().min(1).max(ENROLLMENT_MERCHANT_MAX_LENGTH),
  tid: providerTransactionSchema,
  partner_order_id: z.uuid(),
  partner_user_id: z.uuid(),
  payment_method_type: z.enum(['CARD', 'MONEY']),
  status: z.enum(['PART_CANCEL_PAYMENT', 'CANCEL_PAYMENT']),
  amount,
  canceled_amount: amount,
  cancel_available_amount: amount,
  approved_at: datetime,
});
const cancelSchema = paymentSchema.extend({
  aid: providerTransactionSchema,
  payload: z.string(),
  approved_cancel_amount: amount,
  canceled_at: datetime,
});
const querySchema = paymentSchema.extend({
  payment_action_details: z
    .array(
      z.object({
        aid: providerTransactionSchema,
        payment_action_type: z.enum(['PAYMENT', 'CANCEL', 'ISSUED_SID']),
        amount: money,
        approved_at: datetime,
        payload: z.string().nullable().optional(),
        green_deposit: z.literal(0).optional(),
      }),
    )
    .min(1)
    .max(ENROLLMENT_MAX_QUERY_ACTIONS),
});
function matchesPayment(
  payment: z.output<typeof paymentSchema>,
  input: RefundInput,
  merchantAccount: string,
) {
  const totals = refundTotals(input);
  return (
    payment.cid === merchantAccount &&
    payment.tid === input.providerPaymentId &&
    payment.partner_order_id === input.orderId &&
    payment.partner_user_id === input.customerRef &&
    payment.amount.total === input.originalAmountKrw &&
    payment.canceled_amount.total === totals.cumulativeRefundedKrw &&
    payment.cancel_available_amount.total === totals.remainingKrw &&
    payment.status ===
      (totals.remainingKrw === 0 ? 'CANCEL_PAYMENT' : 'PART_CANCEL_PAYMENT')
  );
}
function verified(
  input: RefundInput,
  merchantAccount: string,
  providerTransactionId: string,
  refundedAt: string,
) {
  return {
    ok: true as const,
    data: {
      ...input,
      merchantAccount,
      providerTransactionId,
      refundedAt,
      ...refundTotals(input),
    },
  };
}
function verifyCancel(
  value: unknown,
  input: RefundInput,
  merchantAccount: string,
) {
  const parsed = cancelSchema.safeParse(value);
  if (!parsed.success) return preparationFailure('OUTCOME_UNKNOWN');
  const payment = parsed.data;
  if (
    !matchesPayment(payment, input, merchantAccount) ||
    payment.payload !== refundOperationMarker(input.attemptId) ||
    payment.aid === input.originalProviderTransactionId ||
    payment.approved_cancel_amount.total !== input.amountKrw ||
    Date.parse(payment.canceled_at) < Date.parse(payment.approved_at)
  )
    return preparationFailure('OUTCOME_UNKNOWN');
  return verified(input, merchantAccount, payment.aid, payment.canceled_at);
}
function verifyQuery(
  value: unknown,
  input: RefundInput,
  merchantAccount: string,
) {
  const parsed = querySchema.safeParse(value);
  if (!parsed.success) return preparationFailure('OUTCOME_UNKNOWN');
  const payment = parsed.data;
  const charges = payment.payment_action_details.filter(
    (action) => action.payment_action_type === 'PAYMENT',
  );
  const cancels = payment.payment_action_details.filter(
    (action) => action.payment_action_type === 'CANCEL',
  );
  const matches = cancels.filter(
    (action) => action.payload === refundOperationMarker(input.attemptId),
  );
  const charge = charges[0];
  const action = matches[0];
  if (
    !matchesPayment(payment, input, merchantAccount) ||
    charges.length !== 1 ||
    !charge ||
    charge.aid !== input.originalProviderTransactionId ||
    charge.amount !== input.originalAmountKrw ||
    charge.approved_at !== payment.approved_at ||
    matches.length !== 1 ||
    !action ||
    action.amount !== input.amountKrw ||
    Date.parse(action.approved_at) < Date.parse(payment.approved_at) ||
    cancels.some(
      (cancel) =>
        cancel.amount <= 0 ||
        Date.parse(cancel.approved_at) < Date.parse(payment.approved_at) ||
        Date.parse(cancel.approved_at) > Date.parse(action.approved_at),
    ) ||
    new Set(payment.payment_action_details.map((item) => item.aid)).size !==
      payment.payment_action_details.length ||
    cancels.reduce((sum, cancel) => sum + cancel.amount, 0) !==
      refundTotals(input).cumulativeRefundedKrw
  )
    return preparationFailure('OUTCOME_UNKNOWN');
  return verified(input, merchantAccount, action.aid, action.approved_at);
}

export function createKakaoRefundAdapter(
  env: ServerEnv,
  transport: EnrollmentTransport = fetch,
): RefundPaymentAdapter {
  const configuration = requireIntegrationConfiguration(
    'kakaopay_subscription',
    parsePreparationEnvironment(env),
  );
  async function execute(input: RefundInput, query: boolean) {
    if (!configuration.ok) return preparationFailure(configuration.error.code);
    const parsed = refundInputSchema.safeParse(input);
    if (!parsed.success) return preparationFailure('INVALID_INPUT');
    const { credentials } = configuration.data;
    const result = await enrollmentRequest(
      transport,
      query ? KAKAOPAY_ORDER_URL : KAKAOPAY_REFUND_URL,
      {
        method: 'POST',
        headers: {
          Authorization: `SECRET_KEY ${credentials.KAKAOPAY_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: {
          cid: credentials.KAKAOPAY_RECURRING_CID,
          ...(credentials.KAKAOPAY_CID_SECRET
            ? { cid_secret: credentials.KAKAOPAY_CID_SECRET }
            : {}),
          tid: parsed.data.providerPaymentId,
          ...(!query
            ? {
                cancel_amount: parsed.data.amountKrw,
                cancel_tax_free_amount: 0,
                // Original approvals omit vat_amount; the documented corresponding
                // cancellation behavior is to omit cancel_vat_amount, not invent tax.
                cancel_available_amount:
                  parsed.data.originalAmountKrw - parsed.data.refundedBeforeKrw,
                payload: refundOperationMarker(parsed.data.attemptId),
              }
            : {}),
        },
        timeoutMs: query
          ? ENROLLMENT_QUERY_TIMEOUT_MS
          : ENROLLMENT_CHARGE_TIMEOUT_MS,
        recognizedRejection: () => false,
        reconciliation: query,
      },
    );
    if (!result.ok) return result;
    return query
      ? verifyQuery(
          result.data,
          parsed.data,
          credentials.KAKAOPAY_RECURRING_CID,
        )
      : verifyCancel(
          result.data,
          parsed.data,
          credentials.KAKAOPAY_RECURRING_CID,
        );
  }
  // No idempotency header is documented. Exactly one dispatch is granted by the
  // database; lease expiry permits only query, never another cancellation POST.
  return {
    refund: (input) => execute(input, false),
    query: (input) => execute(input, true),
  };
}
