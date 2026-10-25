import { z } from 'zod';

// Technical bounds only. Actual notice days/hour and mandatory status require
// an explicitly approved immutable database policy; no business default here.
export const BILLING_NOTICE = {
  pageSize: 50,
  scanLimit: 20,
  workerPages: 5,
  workerLimit: 100,
  workerBudgetMs: 40_000,
  databaseTimeoutMs: 5000,
  bodyTimeoutMs: 1000,
  bodyLimit: 512,
  secretMinLength: 32,
  secretMaxLength: 256,
  cursorMaxLength: 100,
} as const;
export const BILLING_NOTICE_REQUEST_TIMEOUT_MS = 15_000;
export const BILLING_NOTICE_RESPONSE_MAX_BYTES = 64 * 1024;
export const BILLING_NOTICE_HTTP_OK = 200;
export const BILLING_NOTICE_TIME_ZONE = 'Asia/Seoul';
export const BILLING_NOTICE_ERROR_STATUS = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export const BILLING_NOTICE_CRON_STATUS = {
  OK: 200,
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export type BillingNoticeError = keyof typeof BILLING_NOTICE_ERROR_STATUS;
export type BillingNoticeResult<T> =
  { ok: true; data: T } | { ok: false; code: BillingNoticeError };
const timestamp = z.iso.datetime({ offset: true });
export const billingNoticeCursorSchema = z
  .string()
  .max(BILLING_NOTICE.cursorMaxLength)
  .refine((value) => {
    const parts = value.split('|');
    return (
      parts.length === 2 &&
      timestamp.safeParse(parts[0]).success &&
      z.uuid().safeParse(parts[1]).success
    );
  });
export const billingNoticeSchema = z.strictObject({
  id: z.uuid(),
  subscriptionId: z.uuid(),
  artistName: z.string().min(1).max(200),
  amountKrw: z.number().int().positive().max(2147483647),
  currency: z.literal('KRW'),
  billingAt: timestamp,
  createdAt: timestamp,
  readAt: timestamp.nullable(),
  mandatory: z.boolean(),
});
export type BillingNotice = z.output<typeof billingNoticeSchema>;
export const billingNoticeListSchema = z
  .strictObject({
    notices: z.array(billingNoticeSchema).max(BILLING_NOTICE.pageSize),
    hasMore: z.boolean(),
    nextCursor: billingNoticeCursorSchema.nullable(),
    billingEnabled: z.boolean(),
  })
  .refine((data) => data.hasMore === (data.nextCursor !== null));
export type BillingNoticeList = z.output<typeof billingNoticeListSchema>;
export const billingNoticeReadSchema = z.null();
export const billingNoticeReadInputSchema = z.strictObject({
  noticeId: z.uuid(),
});
export const billingNoticePreferenceSchema = z.strictObject({
  billingEnabled: z.boolean(),
});
export const billingNoticePreferenceInputSchema = z.strictObject({
  enabled: z.boolean(),
});
export const billingNoticeCreatedSchema = z
  .strictObject({
    noticeId: z.uuid().nullable(),
    created: z.boolean(),
    pushJobs: z.number().int().nonnegative().max(2147483647),
  })
  .refine((data) => !data.created || data.noticeId !== null);
export type BillingNoticeCreated = z.output<typeof billingNoticeCreatedSchema>;
export const billingNoticeWorkerSummarySchema = z
  .strictObject({
    examined: z.number().int().nonnegative().max(BILLING_NOTICE.workerLimit),
    created: z.number().int().nonnegative().max(BILLING_NOTICE.workerLimit),
    skipped: z.number().int().nonnegative().max(BILLING_NOTICE.workerLimit),
    failed: z.number().int().nonnegative().max(BILLING_NOTICE.workerLimit),
    pushJobsQueued: z
      .number()
      .int()
      .nonnegative()
      .max(BILLING_NOTICE.workerLimit * 2147483647),
    hasMore: z.boolean(),
  })
  .refine(
    (value) => value.created + value.skipped + value.failed === value.examined,
  );
export type BillingNoticeWorkerSummary = z.output<
  typeof billingNoticeWorkerSummarySchema
>;
