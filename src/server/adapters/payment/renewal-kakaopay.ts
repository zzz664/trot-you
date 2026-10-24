import 'server-only';
import { z } from 'zod';
import type { ServerEnv } from '@/config/env.server';
import {
  ENROLLMENT_CHARGE_TIMEOUT_MS,
  ENROLLMENT_MERCHANT_MAX_LENGTH,
  KAKAOPAY_DATETIME_OFFSET,
} from '@/config/enrollment-provider';
import {
  KAKAOPAY_RENEWAL_DEFINITE_REJECTION,
  KAKAOPAY_SUBSCRIPTION_URL,
  RENEWAL_PROVIDER_ITEM_NAME,
} from '@/config/renewal-provider';
import { requireIntegrationConfiguration } from '@/server/configuration';
import {
  providerCredentialSchema,
  providerTransactionSchema,
  type EnrollmentTransport,
} from './enrollment';
import { createKakaoEnrollmentAdapter } from './enrollment-kakaopay';
import { parsePreparationEnvironment, preparationFailure } from './preparation';
import {
  renewalChargeSchema,
  renewalQuerySchema,
  type RenewalPaymentAdapter,
} from './renewal';
import { renewalRequest } from './renewal-http';

const datetimeSchema = z
  .string()
  .transform((value) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)
      ? `${value}${KAKAOPAY_DATETIME_OFFSET}`
      : value,
  )
  .pipe(z.iso.datetime({ offset: true }))
  .transform((value) => new Date(value).toISOString());
const paymentSchema = z.object({
  cid: z.string().min(1).max(ENROLLMENT_MERCHANT_MAX_LENGTH),
  sid: providerCredentialSchema,
  tid: providerTransactionSchema,
  aid: providerTransactionSchema,
  partner_order_id: z.uuid(),
  partner_user_id: z.uuid(),
  payment_method_type: z.enum(['CARD', 'MONEY']),
  amount: z.object({
    total: z.number().int().positive(),
    tax_free: z.literal(0),
    green_deposit: z.literal(0).optional(),
  }),
  approved_at: datetimeSchema,
});
const rejectionSchema = z.object({ error_code: z.number().int() });

export function createKakaoRenewalAdapter(
  env: ServerEnv,
  transport: EnrollmentTransport = fetch,
): RenewalPaymentAdapter {
  const configuration = requireIntegrationConfiguration(
    'kakaopay_subscription',
    parsePreparationEnvironment(env),
  );
  const enrollment = createKakaoEnrollmentAdapter(env, transport);
  return {
    async charge(input) {
      if (!configuration.ok)
        return preparationFailure(configuration.error.code);
      const parsed = renewalChargeSchema.safeParse(input);
      if (!parsed.success) return preparationFailure('INVALID_INPUT');
      const { credentials } = configuration.data;
      const result = await renewalRequest(
        transport,
        KAKAOPAY_SUBSCRIPTION_URL,
        {
          headers: {
            Authorization: `SECRET_KEY ${credentials.KAKAOPAY_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
          body: {
            cid: credentials.KAKAOPAY_RECURRING_CID,
            ...(credentials.KAKAOPAY_CID_SECRET
              ? { cid_secret: credentials.KAKAOPAY_CID_SECRET }
              : {}),
            sid: parsed.data.credential,
            partner_order_id: parsed.data.orderId,
            partner_user_id: parsed.data.customerRef,
            item_name: RENEWAL_PROVIDER_ITEM_NAME,
            quantity: 1,
            total_amount: parsed.data.amountKrw,
            tax_free_amount: 0,
          },
          timeoutMs: ENROLLMENT_CHARGE_TIMEOUT_MS,
          classifyRejection(body) {
            const rejected = rejectionSchema.safeParse(body);
            return rejected.success &&
              rejected.data.error_code === KAKAOPAY_RENEWAL_DEFINITE_REJECTION
              ? 'customer_action'
              : null;
          },
        },
      );
      if (!result.ok) return result;
      const payment = paymentSchema.safeParse(result.data);
      if (
        !payment.success ||
        payment.data.cid !== credentials.KAKAOPAY_RECURRING_CID ||
        payment.data.sid !== parsed.data.credential ||
        payment.data.partner_order_id !== parsed.data.orderId ||
        payment.data.partner_user_id !== parsed.data.customerRef ||
        payment.data.amount.total !== parsed.data.amountKrw
      )
        return preparationFailure('OUTCOME_UNKNOWN');
      return {
        ok: true,
        data: {
          customerRef: parsed.data.customerRef,
          orderId: parsed.data.orderId,
          amountKrw: parsed.data.amountKrw,
          providerPaymentId: payment.data.tid,
          providerTransactionId: payment.data.aid,
          approvedAt: payment.data.approved_at,
          currency: 'KRW',
          merchantAccount: credentials.KAKAOPAY_RECURRING_CID,
        },
      };
    },
    async query(input) {
      const parsed = renewalQuerySchema.safeParse(input);
      if (!parsed.success) return preparationFailure('INVALID_INPUT');
      // Public order lookup requires TID. A lost renewal response may lose it;
      // SID status/last_approved_at never identifies this order or proves money.
      if (!parsed.data.providerPaymentId)
        return preparationFailure('OUTCOME_UNKNOWN');
      return enrollment.query({
        customerRef: parsed.data.customerRef,
        orderId: parsed.data.orderId,
        amountKrw: parsed.data.amountKrw,
        tid: parsed.data.providerPaymentId,
      });
    },
  };
}
