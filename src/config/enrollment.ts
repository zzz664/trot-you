import { z } from 'zod';
import {
  BILLING_PERIOD_CALENDARS,
  SUPPORTED_PAYMENT_TAX_BASIS,
} from './billing-policy';
import { artistSlugSchema } from './artists';
import { checkoutProviderSchema, type CheckoutResult } from './checkout';
import { TOSS_BILLING_SDK_URL } from './payment-preparation';

export const ENROLLMENT_MOBILE_BROWSER_PATTERN =
  /Android|iPhone|iPad|iPod|Mobile/i;
export const ENROLLMENT_CALLBACK_FIELD_COUNT = 3;
export const ENROLLMENT_REQUEST_TIMEOUT_MS = 285_000;
export const ENROLLMENT_STATUS_POLL_MS = 3_000;
export const ENROLLMENT_RESPONSE_MAX_BYTES = 524_288;
export const ENROLLMENT_STATES = [
  'awaiting_authorization',
  'awaiting_confirmation',
  'processing',
  'succeeded',
  'failed',
  'canceled',
  'expired',
  'unknown',
  'manual_review',
] as const;
export const enrollmentSessionSchema = z.strictObject({ sessionId: z.uuid() });
export const enrollmentConfirmSchema = enrollmentSessionSchema.extend({
  policyVersion: z.uuid(),
  amountKrw: z.number().int().nonnegative().safe(),
  accepted: z.literal(true),
});
export const enrollmentStatusSchema = z.strictObject({
  sessionId: z.uuid(),
  status: z.enum(ENROLLMENT_STATES),
  provider: checkoutProviderSchema,
  environment: z.enum(['test', 'live']),
  artist: z.strictObject({
    slug: artistSlugSchema,
    name: z.string().min(1).max(100),
  }),
  policy: z.strictObject({
    version: z.uuid(),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(100_000),
    billingPeriodCalendar: z.enum(BILLING_PERIOD_CALENDARS),
    paymentTaxBasis: z.literal(SUPPORTED_PAYMENT_TAX_BASIS),
  }),
  amountKrw: z.number().int().nonnegative().safe(),
  regularPriceKrw: z.number().int().positive().safe(),
  expiresAt: z.iso.datetime({ offset: true }),
  canConfirm: z.boolean(),
  canCancel: z.boolean(),
  canReconcile: z.boolean(),
});
export const enrollmentLaunchSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('toss_billing_auth'),
    sdkUrl: z.literal(TOSS_BILLING_SDK_URL),
    clientKey: z.string().regex(/^(test|live)_ck_[A-Za-z0-9_-]+$/),
    payment: z.strictObject({ customerKey: z.uuid() }),
    requestBillingAuth: z.strictObject({
      method: z.literal('CARD'),
      successUrl: z.url().max(2048),
      failUrl: z.url().max(2048),
    }),
  }),
  z.strictObject({
    kind: z.literal('kakaopay_redirect'),
    redirectUrl: z.url().max(2048),
    desktopRedirectUrl: z.url().max(2048),
  }),
]);
export const enrollmentStartSchema = z.strictObject({
  status: enrollmentStatusSchema,
  launch: enrollmentLaunchSchema.optional(),
});
export type EnrollmentStatus = z.output<typeof enrollmentStatusSchema>;
export type EnrollmentLaunch = z.output<typeof enrollmentLaunchSchema>;
export type EnrollmentStart = z.output<typeof enrollmentStartSchema>;
export type EnrollmentSessionInput = z.output<typeof enrollmentSessionSchema>;
export type EnrollmentConfirmInput = z.output<typeof enrollmentConfirmSchema>;
export type EnrollmentResult<T> = CheckoutResult<T>;
