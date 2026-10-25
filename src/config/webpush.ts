import { z } from 'zod';

// Execution/transport ceilings, not an assertion of device delivery latency.
export const WEBPUSH = {
  bodyLimit: 4096,
  bodyTimeoutMs: 1000,
  databaseTimeoutMs: 5000,
  providerTimeoutMs: 4000,
  minimumLeaseRemainingMs: 5000,
  workerBudgetMs: 45_000,
  batchSize: 100,
  recoveryLimit: 100,
  maxWorkerPages: 10,
  workerLimit: 1000,
  concurrency: 20,
  secretMinLength: 32,
  secretMaxLength: 256,
  endpointMaxLength: 2048,
  consentVersionMaxLength: 100,
  retryAfterMaxSeconds: 86400,
  httpOk: 200,
} as const;
export const WEBPUSH_ERROR_STATUS = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export const WEBPUSH_CRON_STATUS = {
  OK: 200,
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export type WebPushError = keyof typeof WEBPUSH_ERROR_STATUS;
export type WebPushResult<T> =
  { ok: true; data: T } | { ok: false; code: WebPushError };
export const webPushEndpointSchema = z
  .string()
  .min(1)
  .max(WEBPUSH.endpointMaxLength);
export const webPushSubscriptionSchema = z.strictObject({
  endpoint: webPushEndpointSchema,
  keys: z.strictObject({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
});
export type WebPushSubscription = z.output<typeof webPushSubscriptionSchema>;
export const webPushStatusFieldsSchema = z.strictObject({
  configured: z.boolean(),
  publicKey: z
    .string()
    .regex(/^[A-Za-z0-9_-]{87}$/)
    .nullable(),
  consentVersion: z
    .string()
    .min(1)
    .max(WEBPUSH.consentVersionMaxLength)
    .nullable(),
  webpushEnabled: z.boolean(),
  newMessage: z.boolean(),
  deviceId: z.uuid().nullable(),
  deviceActive: z.boolean(),
});
export const webPushStatusSchema = webPushStatusFieldsSchema.refine(
  (value) =>
    (!value.configured ||
      (value.publicKey !== null && value.consentVersion !== null)) &&
    (!value.deviceActive ||
      (value.deviceId !== null && value.webpushEnabled && value.newMessage)),
);
export type WebPushStatus = z.output<typeof webPushStatusSchema>;
export const webPushSubscribeSchema = z.strictObject({
  action: z.literal('subscribe'),
  subscription: webPushSubscriptionSchema,
  applicationServerKey: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
  consentVersion: z.string().min(1).max(WEBPUSH.consentVersionMaxLength),
  confirmed: z.literal(true),
});
export const webPushStatusInputSchema = z.strictObject({
  action: z.literal('status'),
  endpoint: webPushEndpointSchema.nullable(),
});
export const webPushRevokeSchema = z.strictObject({
  endpoint: webPushEndpointSchema,
});
export const webPushWorkerSummarySchema = z
  .strictObject({
    examined: z.number().int().nonnegative().max(WEBPUSH.workerLimit),
    recoveryChecked: z.number().int().nonnegative().max(WEBPUSH.recoveryLimit),
    acceptedByPushService: z
      .number()
      .int()
      .nonnegative()
      .max(WEBPUSH.workerLimit),
    skipped: z.number().int().nonnegative().max(WEBPUSH.workerLimit),
    uncertain: z.number().int().nonnegative().max(WEBPUSH.workerLimit),
    failed: z.number().int().nonnegative().max(WEBPUSH.workerLimit),
    hasMore: z.boolean(),
  })
  .refine(
    (summary) =>
      summary.acceptedByPushService +
        summary.skipped +
        summary.uncertain +
        summary.failed ===
      summary.examined,
  );
export type WebPushWorkerSummary = z.output<typeof webPushWorkerSummarySchema>;
