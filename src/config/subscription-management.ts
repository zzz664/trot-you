import { z } from 'zod';
import { ENROLLMENT_MAX_AMOUNT_KRW } from './enrollment-provider';

// Technical transport/display limits only; none define refund eligibility.
export const MANAGEMENT_DISPLAY_TIME_ZONE = 'Asia/Seoul';
export const MANAGEMENT_BODY_LIMIT = 4096;
export const MANAGEMENT_RESPONSE_MAX_BYTES = 262144;
export const MANAGEMENT_REQUEST_TIMEOUT_MS = 30_000;
export const MANAGEMENT_BODY_TIMEOUT_MS = 5_000;
export const MANAGEMENT_REASON_MAX_LENGTH = 500;
export const MANAGEMENT_POLICY_BODY_MAX_LENGTH = 20_000;
export const MANAGEMENT_TITLE_MAX_LENGTH = 200;
export const MANAGEMENT_LIST_LIMIT = 100;
export const MANAGEMENT_CHARGE_LIMIT = 20;
export const MANAGEMENT_ADMIN_LIMIT = 50;
export const MANAGEMENT_MAX_PAGE = 10_000;
export const REFUND_TIMESTAMP_PRECISION_MS = 1000;
export const REFUND_LEASE_SECONDS = 180;
export const MANAGEMENT_HTTP_OK = 200;
export const MANAGEMENT_ERROR_STATUS = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  POLICY_NOT_APPROVED: 409,
  EXECUTION_DISABLED: 503,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export type ManagementError = keyof typeof MANAGEMENT_ERROR_STATUS;
export type ManagementResult<T> =
  { ok: true; data: T } | { ok: false; code: ManagementError };

const instant = z.iso.datetime({ offset: true });
const money = z.number().int().nonnegative().max(ENROLLMENT_MAX_AMOUNT_KRW);
const amount = money.positive();
const label = z.string().min(1).max(MANAGEMENT_TITLE_MAX_LENGTH);
const reason = z.string().trim().min(1).max(MANAGEMENT_REASON_MAX_LENGTH);
export const managementPageSchema = z
  .union([
    z.number(),
    z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .transform(Number),
  ])
  .pipe(z.number().int().min(1).max(MANAGEMENT_MAX_PAGE));
export const subscriptionInputSchema = z.strictObject({
  subscriptionId: z.uuid(),
});
export const refundRequestInputSchema = z.strictObject({
  subscriptionId: z.uuid(),
  originalEventId: z.uuid(),
  amountKrw: amount,
  reason,
  idempotencyKey: z.uuid(),
});
export const refundActionInputSchema = z.strictObject({ requestId: z.uuid() });
export const refundAuthorizeInputSchema = z.strictObject({
  requestId: z.uuid(),
  amountKrw: amount,
  policyVersion: z.uuid(),
  reason,
  accepted: z.literal(true),
});
export const refundRejectInputSchema = z.strictObject({
  requestId: z.uuid(),
  reason,
});
export type SubscriptionInput = z.output<typeof subscriptionInputSchema>;
export type RefundRequestInput = z.output<typeof refundRequestInputSchema>;
export type RefundAuthorizeInput = z.output<typeof refundAuthorizeInputSchema>;
export type RefundRejectInput = z.output<typeof refundRejectInputSchema>;
export type RefundActionInput = z.output<typeof refundActionInputSchema>;

export const refundRequestSchema = z
  .object({
    id: z.uuid(),
    subscription_id: z.uuid(),
    original_event_id: z.uuid(),
    artist_name: label,
    artist_slug: label,
    amount_krw: amount,
    charge_amount_krw: amount,
    refunded_krw: money,
    currency: z.literal('KRW'),
    status: z.enum([
      'requested',
      'authorized',
      'inflight',
      'unknown',
      'succeeded',
      'failed',
      'rejected',
    ]),
    reason,
    decision_reason: reason.nullable(),
    policy_version: z.uuid().nullable(),
    requested_at: instant,
    decided_at: instant.nullable(),
    finished_at: instant.nullable(),
    can_reconcile: z.boolean(),
    requires_manual_review: z.boolean(),
  })
  .refine(
    (row) =>
      row.refunded_krw <= row.charge_amount_krw &&
      row.amount_krw <= row.charge_amount_krw,
  );
export type RefundRequest = z.output<typeof refundRequestSchema>;
export const refundPolicySchema = z.object({
  version: z.uuid(),
  title: label,
  body: z.string().min(1).max(MANAGEMENT_POLICY_BODY_MAX_LENGTH),
  access_effect: z.literal('preserve_paid_access'),
});
export type RefundPolicy = z.output<typeof refundPolicySchema>;
export const subscriptionSummarySchema = z.object({
  id: z.uuid(),
  artist_id: z.uuid(),
  artist_name: label,
  artist_slug: label,
  status: z.enum(['pending', 'active', 'grace', 'canceled', 'expired']),
  current_period_end: instant.nullable(),
  next_billing_at: instant.nullable(),
  canceled_at: instant.nullable(),
  has_unresolved_charge: z.boolean(),
  has_access: z.boolean(),
  can_cancel: z.boolean(),
});
export type SubscriptionSummary = z.output<typeof subscriptionSummarySchema>;
export const subscriptionChargeSchema = z
  .object({
    id: z.uuid(),
    amount_krw: amount,
    currency: z.literal('KRW'),
    occurred_at: instant,
    refunded_krw: money,
    refund_request: refundRequestSchema.nullable(),
    can_request_refund: z.boolean(),
  })
  .refine(
    (row) =>
      row.refunded_krw <= row.amount_krw &&
      (!row.refund_request || row.refund_request.original_event_id === row.id),
  );
export type SubscriptionCharge = z.output<typeof subscriptionChargeSchema>;
export const subscriptionListSchema = z.object({
  subscriptions: z.array(subscriptionSummarySchema).max(MANAGEMENT_LIST_LIMIT),
  more_available: z.boolean(),
  page: managementPageSchema,
});
export type SubscriptionList = z.output<typeof subscriptionListSchema>;
export const subscriptionDetailSchema = subscriptionSummarySchema
  .extend({
    charges: z.array(subscriptionChargeSchema).max(MANAGEMENT_CHARGE_LIMIT),
    charges_more_available: z.boolean(),
    page: managementPageSchema,
  })
  .refine((row) =>
    row.charges.every(
      (charge) =>
        !charge.refund_request ||
        charge.refund_request.subscription_id === row.id,
    ),
  );
export type SubscriptionDetail = z.output<typeof subscriptionDetailSchema>;
export const adminRefundListSchema = z.object({
  requests: z.array(refundRequestSchema).max(MANAGEMENT_ADMIN_LIMIT),
  policy: refundPolicySchema.nullable(),
  more_available: z.boolean(),
  page: managementPageSchema,
});
export type AdminRefundList = z.output<typeof adminRefundListSchema>;
export const adminRefundRecordSchema = z.object({
  request: refundRequestSchema,
  policy: refundPolicySchema.nullable(),
});
export const adminRefundDetailSchema = adminRefundRecordSchema.extend({
  execution_enabled: z.boolean(),
  can_authorize: z.boolean(),
  can_reject: z.boolean(),
  can_execute: z.boolean(),
  can_reconcile: z.boolean(),
});
export type AdminRefundDetail = z.output<typeof adminRefundDetailSchema>;
export type AdminRefundRecord = z.output<typeof adminRefundRecordSchema>;
