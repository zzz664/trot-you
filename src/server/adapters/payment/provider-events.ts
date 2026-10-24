import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  ENROLLMENT_MAX_AMOUNT_KRW,
  ENROLLMENT_MERCHANT_MAX_LENGTH,
} from '@/config/enrollment-provider';
import {
  PROVIDER_EVENT_CREATED_AT_MAX_LENGTH,
  PROVIDER_EVENT_SEMANTIC_KEY_VERSION,
  PROVIDER_EVENT_TRANSMISSION_ID_MAX_LENGTH,
  TOSS_PROVIDER_EVENT_STATUSES,
  TOSS_PROVIDER_EVENT_TYPE,
} from '@/config/provider-events';
import { providerTransactionSchema } from './enrollment';

export const providerEventTransmissionIdSchema = z
  .string()
  .min(1)
  .max(PROVIDER_EVENT_TRANSMISSION_ID_MAX_LENGTH)
  .regex(/^[A-Za-z0-9._:-]+$/);

const money = z.number().int().nonnegative().max(ENROLLMENT_MAX_AMOUNT_KRW);
const notificationSchema = z.object({
  eventType: z.literal(TOSS_PROVIDER_EVENT_TYPE),
  // Provider-created time is untrusted metadata, not a financial timestamp or
  // replay authority. Keep its documented offsetless/offset form opaque.
  createdAt: z
    .string()
    .max(PROVIDER_EVENT_CREATED_AT_MAX_LENGTH)
    .pipe(z.iso.datetime({ offset: true, local: true })),
  data: z.object({
    mId: z
      .string()
      .min(1)
      .max(ENROLLMENT_MERCHANT_MAX_LENGTH)
      .regex(/^[A-Za-z0-9_-]+$/),
    orderId: z.uuid(),
    paymentKey: providerTransactionSchema,
    lastTransactionKey: providerTransactionSchema.nullable(),
    type: z.literal('BILLING'),
    method: z.literal('카드'),
    currency: z.literal('KRW'),
    status: z.enum(TOSS_PROVIDER_EVENT_STATUSES),
    totalAmount: money.positive(),
    balanceAmount: money,
    taxFreeAmount: z.literal(0),
    taxExemptionAmount: z.literal(0),
  }),
});

export type ProviderEventFailure = {
  ok: false;
  code: 'INVALID_INPUT' | 'UNSUPPORTED_EVENT' | 'PAYLOAD_TOO_LARGE';
};
export type UntrustedTossProviderEvent = {
  provider: 'toss';
  trust: 'unverified';
  eventType: typeof TOSS_PROVIDER_EVENT_TYPE;
  transmissionId: string;
  semanticKey: string;
  orderId: string;
  providerPaymentId: string;
  providerTransactionId: string | null;
  merchantAccount: string;
  status: (typeof TOSS_PROVIDER_EVENT_STATUSES)[number];
  totalAmountKrw: number;
  balanceAmountKrw: number;
  createdAt: string;
};
export type ProviderEventResult =
  { ok: true; data: UntrustedTossProviderEvent } | ProviderEventFailure;

// https://docs.tosspayments.com/reference/using-api/webhook-events
// No general Toss payment HMAC exists: the signature documented there applies
// only to payout.changed/seller.changed. A transmission ID is dedupe metadata,
// NOT proof of origin. Automatic-billing approvals do not normally send this
// event, so polling known unknown operations remains the recovery mechanism.
// BILLING_DELETED would expose a billing key without a documented safe read
// verification path. Kakao and unsupported Toss products are not accepted here.
export function parseTossProviderEvent(
  body: unknown,
  transmissionId: string | null,
): ProviderEventResult {
  const identity = providerEventTransmissionIdSchema.safeParse(transmissionId);
  if (!identity.success) return { ok: false, code: 'INVALID_INPUT' };
  const event = z.object({ eventType: z.string() }).safeParse(body);
  if (!event.success) return { ok: false, code: 'INVALID_INPUT' };
  if (event.data.eventType !== TOSS_PROVIDER_EVENT_TYPE)
    return { ok: false, code: 'UNSUPPORTED_EVENT' };
  const parsed = notificationSchema.safeParse(body);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const payment = parsed.data.data;
  if (
    payment.balanceAmount > payment.totalAmount ||
    (payment.status === 'DONE' &&
      payment.balanceAmount !== payment.totalAmount) ||
    (payment.status === 'CANCELED' && payment.balanceAmount !== 0) ||
    (payment.status === 'PARTIAL_CANCELED' &&
      (payment.balanceAmount === 0 ||
        payment.balanceAmount === payment.totalAmount))
  )
    return { ok: false, code: 'INVALID_INPUT' };
  // Advisory coalescing key, not a hash of a trusted provider event. Forged
  // transmission IDs, timestamps or action IDs must not create unbounded rows
  // for the same known order/status. Independent operation recovery prevents
  // coalescing later partial-cancel hints from losing an authorized refund.
  const semanticKey = createHash('sha256')
    .update(
      JSON.stringify([
        PROVIDER_EVENT_SEMANTIC_KEY_VERSION,
        'toss',
        TOSS_PROVIDER_EVENT_TYPE,
        payment.mId,
        payment.orderId,
        payment.status,
      ]),
    )
    .digest('hex');
  return {
    ok: true,
    data: {
      provider: 'toss',
      trust: 'unverified',
      eventType: TOSS_PROVIDER_EVENT_TYPE,
      transmissionId: identity.data,
      semanticKey,
      orderId: payment.orderId,
      providerPaymentId: payment.paymentKey,
      providerTransactionId: payment.lastTransactionKey,
      merchantAccount: payment.mId,
      status: payment.status,
      totalAmountKrw: payment.totalAmount,
      balanceAmountKrw: payment.balanceAmount,
      createdAt: parsed.data.createdAt,
    },
  };
}
