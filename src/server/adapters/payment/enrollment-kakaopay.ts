import 'server-only';
import { z } from 'zod';
import type { ServerEnv } from '@/config/env.server';
import {
  ENROLLMENT_CHARGE_TIMEOUT_MS,
  ENROLLMENT_MAX_QUERY_ACTIONS,
  ENROLLMENT_MERCHANT_MAX_LENGTH,
  ENROLLMENT_QUERY_TIMEOUT_MS,
  KAKAOPAY_APPROVE_URL,
  KAKAOPAY_DATETIME_OFFSET,
  KAKAOPAY_DEFINITE_REJECTION_CODES,
  KAKAOPAY_ORDER_URL,
} from '@/config/enrollment-provider';
import {
  KAKAOPAY_READY_URL,
  KAKAOPAY_REDIRECT_ORIGINS,
  KAKAOPAY_REGISTRATION_ITEM_NAME,
  PAYMENT_REDIRECT_MAX_LENGTH,
} from '@/config/payment-preparation';
import { requireIntegrationConfiguration } from '@/server/configuration';
import {
  initialPaymentIdentitySchema,
  providerCredentialSchema,
  providerSecretSchema,
  providerTransactionSchema,
  type EnrollmentTransport,
  type InitialPaymentIdentity,
  type KakaoEnrollmentAdapter,
  type VerifiedInitialCharge,
} from './enrollment';
import { enrollmentRequest } from './enrollment-http';
import {
  parsePreparationEnvironment,
  preparationCallbacks,
  preparationFailure,
  preparationIdentitySchema,
} from './preparation';

const readySchema = preparationIdentitySchema.extend({
  amountKrw: initialPaymentIdentitySchema.shape.amountKrw,
});
const querySchema = initialPaymentIdentitySchema.extend({
  tid: providerTransactionSchema,
});
const approveSchema = querySchema.extend({ pgToken: providerSecretSchema });
const readyResponseSchema = z.object({
  tid: providerTransactionSchema,
  next_redirect_mobile_url: z.string().max(PAYMENT_REDIRECT_MAX_LENGTH),
  next_redirect_pc_url: z.string().max(PAYMENT_REDIRECT_MAX_LENGTH),
});
const providerDatetimeSchema = z
  .string()
  .transform((value) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)
      ? `${value}${KAKAOPAY_DATETIME_OFFSET}`
      : value,
  )
  .pipe(z.iso.datetime({ offset: true }))
  .transform((value) => new Date(value).toISOString());
const amountSchema = z.object({
  total: z.number().int().positive(),
  tax_free: z.literal(0),
});
const paymentSchema = z.object({
  cid: z.string().min(1).max(ENROLLMENT_MERCHANT_MAX_LENGTH),
  tid: providerTransactionSchema,
  partner_order_id: z.uuid(),
  partner_user_id: z.uuid(),
  payment_method_type: z.enum(['CARD', 'MONEY']),
  amount: amountSchema,
  approved_at: providerDatetimeSchema,
});
const approvalResponseSchema = paymentSchema.extend({
  aid: providerTransactionSchema,
  sid: providerCredentialSchema,
});
const queryResponseSchema = paymentSchema.extend({
  status: z.literal('SUCCESS_PAYMENT'),
  canceled_amount: z.object({ total: z.literal(0) }),
  payment_action_details: z
    .array(
      z.object({
        aid: providerTransactionSchema,
        payment_action_type: z.enum(['PAYMENT', 'CANCEL', 'ISSUED_SID']),
        amount: z.number().int().nonnegative(),
        approved_at: providerDatetimeSchema,
      }),
    )
    .min(1)
    .max(ENROLLMENT_MAX_QUERY_ACTIONS),
});
const rejectionSchema = z.object({ error_code: z.number().int() });
function safeRedirect(value: string, mode: 'test' | 'live') {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      url.protocol === 'https:' &&
      KAKAOPAY_REDIRECT_ORIGINS[mode].some((origin) => origin === url.origin)
    );
  } catch {
    return false;
  }
}
function matchesPayment(
  body: z.output<typeof paymentSchema>,
  input: InitialPaymentIdentity & { tid: string },
  cid: string,
) {
  return (
    body.cid === cid &&
    body.tid === input.tid &&
    body.partner_order_id === input.orderId &&
    body.partner_user_id === input.customerRef &&
    body.amount.total === input.amountKrw
  );
}
function verifiedPayment(
  body: z.output<typeof paymentSchema>,
  transactionId: string,
  input: InitialPaymentIdentity,
): VerifiedInitialCharge {
  return {
    customerRef: input.customerRef,
    orderId: input.orderId,
    amountKrw: input.amountKrw,
    currency: 'KRW',
    merchantAccount: body.cid,
    providerPaymentId: body.tid,
    providerTransactionId: transactionId,
    approvedAt: body.approved_at,
  };
}

// Charged enrollment: approve both issues SID and settles the first charge.
// Never follow it with /subscription. Kakao documents no idempotency header;
// durable single dispatch and unknown/manual recovery are service/DB duties.
export function createKakaoEnrollmentAdapter(
  env: ServerEnv,
  transport: EnrollmentTransport = fetch,
): KakaoEnrollmentAdapter {
  const configuration = requireIntegrationConfiguration(
    'kakaopay_subscription',
    parsePreparationEnvironment(env),
  );
  const request = async (
    url: string,
    body: Record<string, unknown>,
    reconciliation = false,
  ) => {
    if (!configuration.ok) return preparationFailure(configuration.error.code);
    const { credentials } = configuration.data;
    return enrollmentRequest(transport, url, {
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
        ...body,
      },
      timeoutMs: reconciliation
        ? ENROLLMENT_QUERY_TIMEOUT_MS
        : ENROLLMENT_CHARGE_TIMEOUT_MS,
      recognizedRejection: (value) => {
        const rejected = rejectionSchema.safeParse(value);
        return (
          rejected.success &&
          KAKAOPAY_DEFINITE_REJECTION_CODES.some(
            (code) => code === rejected.data.error_code,
          )
        );
      },
      reconciliation,
    });
  };
  return {
    async ready(input) {
      if (!configuration.ok)
        return preparationFailure(configuration.error.code);
      const parsed = readySchema.safeParse(input);
      if (!parsed.success) return preparationFailure('INVALID_INPUT');
      const { mode, appOrigin } = configuration.data;
      if (mode === 'disabled')
        return preparationFailure('INTEGRATION_UNAVAILABLE');
      const callbacks = preparationCallbacks(appOrigin, {
        sessionId: parsed.data.sessionId,
        callbackState: parsed.data.callbackState,
        customerRef: parsed.data.customerRef,
        orderId: parsed.data.orderId,
      });
      if (!callbacks) return preparationFailure('CONFIGURATION_INVALID');
      const result = await request(KAKAOPAY_READY_URL, {
        partner_order_id: parsed.data.orderId,
        partner_user_id: parsed.data.customerRef,
        item_name: KAKAOPAY_REGISTRATION_ITEM_NAME,
        quantity: 1,
        total_amount: parsed.data.amountKrw,
        tax_free_amount: 0,
        // Omit vat_amount: provider's documented taxable-amount computation.
        approval_url: callbacks.successUrl,
        cancel_url: callbacks.cancelUrl,
        fail_url: callbacks.failUrl,
      });
      if (!result.ok) return result;
      const ready = readyResponseSchema.safeParse(result.data);
      if (
        !ready.success ||
        !safeRedirect(ready.data.next_redirect_mobile_url, mode) ||
        !safeRedirect(ready.data.next_redirect_pc_url, mode)
      )
        return preparationFailure('OUTCOME_UNKNOWN');
      return {
        ok: true,
        data: {
          tid: ready.data.tid,
          redirects: {
            mobile: ready.data.next_redirect_mobile_url,
            desktop: ready.data.next_redirect_pc_url,
          },
        },
      };
    },
    async approve(input) {
      if (!configuration.ok)
        return preparationFailure(configuration.error.code);
      const parsed = approveSchema.safeParse(input);
      if (!parsed.success) return preparationFailure('INVALID_INPUT');
      const result = await request(KAKAOPAY_APPROVE_URL, {
        tid: parsed.data.tid,
        partner_order_id: parsed.data.orderId,
        partner_user_id: parsed.data.customerRef,
        pg_token: parsed.data.pgToken,
        total_amount: parsed.data.amountKrw,
      });
      if (!result.ok) return result;
      const approved = approvalResponseSchema.safeParse(result.data);
      if (
        !approved.success ||
        !matchesPayment(
          approved.data,
          parsed.data,
          configuration.data.credentials.KAKAOPAY_RECURRING_CID,
        )
      )
        return preparationFailure('OUTCOME_UNKNOWN');
      return {
        ok: true,
        data: {
          credential: approved.data.sid,
          charge: verifiedPayment(
            approved.data,
            approved.data.aid,
            parsed.data,
          ),
        },
      };
    },
    async query(input) {
      if (!configuration.ok)
        return preparationFailure(configuration.error.code);
      const parsed = querySchema.safeParse(input);
      if (!parsed.success) return preparationFailure('INVALID_INPUT');
      const result = await request(
        KAKAOPAY_ORDER_URL,
        { tid: parsed.data.tid },
        true,
      );
      if (!result.ok) return result;
      const queried = queryResponseSchema.safeParse(result.data);
      if (
        !queried.success ||
        !matchesPayment(
          queried.data,
          parsed.data,
          configuration.data.credentials.KAKAOPAY_RECURRING_CID,
        )
      )
        return preparationFailure('OUTCOME_UNKNOWN');
      const actions = queried.data.payment_action_details;
      // Exactly one approval and no cancellation; SID-only issuance is not
      // revenue. The public order contract does not return SID: do not invent
      // credential recovery after an approve response was lost.
      const payments = actions.filter(
        (action) => action.payment_action_type === 'PAYMENT',
      );
      if (
        payments.length !== 1 ||
        actions.some((action) => action.payment_action_type === 'CANCEL') ||
        payments[0]!.amount !== parsed.data.amountKrw ||
        payments[0]!.approved_at !== queried.data.approved_at
      )
        return preparationFailure('OUTCOME_UNKNOWN');
      return {
        ok: true,
        data: verifiedPayment(queried.data, payments[0]!.aid, parsed.data),
      };
    },
  };
}
