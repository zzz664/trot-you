import 'server-only';
import { z } from 'zod';
import {
  BILLING_NOTICE,
  billingNoticeCreatedSchema,
  billingNoticeSchema,
  billingNoticePreferenceSchema,
  type BillingNoticeResult,
  type BillingNoticeError,
} from '@/config/billing-notices';
import type { BillingNoticePort } from '@/server/services/billing-notices/notices';
import type { BillingNoticeQueuePort } from '@/server/services/billing-notices/create-due';
import type { ActorClient } from './client';
import type { CheckoutServiceClient } from './checkout-client';
const errors: Record<string, BillingNoticeError> = {
  BILLING_NOTICE_INVALID_INPUT: 'INVALID_INPUT',
  BILLING_NOTICE_LIMIT_INVALID: 'INVALID_INPUT',
  BILLING_NOTICE_CURSOR_INVALID: 'INVALID_INPUT',
  NOTIFICATION_PREFERENCES_REQUIRED: 'INVALID_INPUT',
  BILLING_NOTICE_NOT_FOUND: 'NOT_FOUND',
  BILLING_NOTICE_FORBIDDEN: 'FORBIDDEN',
  NOTIFICATION_ACTOR_FORBIDDEN: 'FORBIDDEN',
  BILLING_NOTICE_POLICY_NOT_APPROVED: 'SETUP_NOT_READY',
};
function parsed<T>(
  schema: z.ZodType<T>,
  data: unknown,
  error: { message: string } | null,
): BillingNoticeResult<T> {
  if (error)
    return {
      ok: false,
      code: Object.hasOwn(errors, error.message)
        ? errors[error.message]!
        : 'UNAVAILABLE',
    };
  const result = schema.safeParse(data);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, code: 'UNAVAILABLE' };
}
const rowSchema = z
  .object({
    id: z.unknown(),
    subscription_id: z.unknown(),
    artist_name: z.unknown(),
    amount_krw: z.unknown(),
    currency: z.unknown(),
    billing_at: z.unknown(),
    created_at: z.unknown(),
    read_at: z.unknown(),
    mandatory: z.unknown(),
  })
  .transform((row) => ({
    id: row.id,
    subscriptionId: row.subscription_id,
    artistName: row.artist_name,
    amountKrw: row.amount_krw,
    currency: row.currency,
    billingAt: row.billing_at,
    createdAt: row.created_at,
    readAt: row.read_at,
    mandatory: row.mandatory,
  }))
  .pipe(billingNoticeSchema);
const preferenceSchema = z
  .array(
    z
      .object({ billing_enabled: z.boolean() })
      .transform((row) => ({ billingEnabled: row.billing_enabled }))
      .pipe(billingNoticePreferenceSchema),
  )
  .length(1)
  .transform((rows) => rows[0]!);
export function createBillingNoticePort(
  client: ActorClient,
): BillingNoticePort {
  return {
    async list(limit, cursor) {
      const { data, error } = await client.rpc('billing_notice_list', {
        p_limit: limit,
        ...(cursor
          ? {
              p_before_created_at: cursor.beforeCreatedAt,
              p_before_id: cursor.beforeId,
            }
          : {}),
      });
      return parsed(
        z.array(rowSchema).max(BILLING_NOTICE.pageSize + 1),
        data,
        error,
      );
    },
    async preferences() {
      const { data, error } = await client.rpc('billing_notice_preferences');
      return parsed(preferenceSchema, data, error);
    },
    async setPreference(enabled) {
      const { data, error } = await client.rpc(
        'billing_notice_set_preference',
        { p_enabled: enabled },
      );
      return parsed(preferenceSchema, data, error);
    },
    async markRead(id) {
      const { error } = await client.rpc('billing_notice_mark_read', {
        p_notice_id: id,
      });
      return parsed(z.null(), null, error);
    },
  };
}
export function createBillingNoticeQueuePort(
  client: CheckoutServiceClient,
): BillingNoticeQueuePort {
  return {
    async candidates(limit) {
      const { data, error } = await client.rpc('billing_notice_candidates', {
        p_limit: limit,
      });
      return parsed(
        z
          .array(z.object({ subscription_id: z.uuid() }))
          .max(BILLING_NOTICE.scanLimit)
          .transform((rows) => rows.map((row) => row.subscription_id)),
        data,
        error,
      );
    },
    async create(subscriptionId) {
      const { data, error } = await client.rpc('billing_notice_create', {
        p_subscription_id: subscriptionId,
      });
      return parsed(
        z
          .array(
            z
              .object({
                notice_id: z.uuid().nullable(),
                created: z.boolean(),
                push_jobs: z.number(),
              })
              .transform((row) => ({
                noticeId: row.notice_id,
                created: row.created,
                pushJobs: row.push_jobs,
              }))
              .pipe(billingNoticeCreatedSchema),
          )
          .max(1)
          .transform(
            (rows) =>
              rows[0] ?? { noticeId: null, created: false, pushJobs: 0 },
          ),
        data,
        error,
      );
    },
  };
}
