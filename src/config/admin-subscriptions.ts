import { z } from 'zod';
import { artistSlugSchema } from './artists';
import { adminArtistStatusSchema } from './admin-artists';

// Technical query/transport limits, not commercial policy or revenue rules.
export const ADMIN_SUBSCRIPTIONS = {
  pageSize: 20,
  maxPage: 1000,
  maxDays: 366,
  rateDecimalPlaces: 2,
  defaultDays: 30,
  earliestDate: '2000-01-01',
  dayMs: 86_400_000,
  dateLength: 10,
  kstOffsetMs: 32_400_000,
  requestTimeoutMs: 15_000,
  responseMaxBytes: 256 * 1024,
  httpOk: 200,
} as const;
export const ADMIN_SUBSCRIPTION_TIME_ZONE = 'Asia/Seoul';
export const ADMIN_SUBSCRIPTION_ERROR_STATUS = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export type AdminSubscriptionError =
  keyof typeof ADMIN_SUBSCRIPTION_ERROR_STATUS;
export type AdminSubscriptionResult<T> =
  { ok: true; data: T } | { ok: false; code: AdminSubscriptionError };
const date = z.iso
  .date()
  .refine((value) => value >= ADMIN_SUBSCRIPTIONS.earliestDate);
const count = z.number().int().nonnegative().safe();
const page = z.number().int().min(1).max(ADMIN_SUBSCRIPTIONS.maxPage);
export const adminSubscriptionQuerySchema = z
  .strictObject({
    from: date,
    to: date,
    artist_id: z.uuid().nullable(),
    page,
  })
  .refine(
    (query) =>
      query.from <= query.to &&
      Date.parse(query.to) - Date.parse(query.from) <
        ADMIN_SUBSCRIPTIONS.maxDays * ADMIN_SUBSCRIPTIONS.dayMs,
  );
export type AdminSubscriptionQuery = z.output<
  typeof adminSubscriptionQuerySchema
>;
export const adminSubscriptionCurrentSchema = z
  .strictObject({
    total_subscriptions: count,
    subscribers: count,
    active_paid: count,
    grace: count,
    canceled_paid: count,
    pending: count,
    expired: count,
    out_of_access: count,
  })
  .refine(
    (value) =>
      value.total_subscriptions ===
        value.active_paid +
          value.grace +
          value.canceled_paid +
          value.pending +
          value.expired +
          value.out_of_access &&
      value.subscribers <=
        value.active_paid + value.grace + value.canceled_paid,
  );
export type AdminSubscriptionCurrent = z.output<
  typeof adminSubscriptionCurrentSchema
>;
export const adminSubscriptionPeriodSchema = z
  .strictObject({
    new_subscriptions: count,
    cancellations: count,
    renewal_due: count,
    renewal_paid: count,
    renewal_rate: z.number().min(0).max(100).nullable(),
  })
  .refine(
    (value) =>
      value.renewal_paid <= value.renewal_due &&
      (value.renewal_due === 0
        ? value.renewal_rate === null
        : value.renewal_rate !== null &&
          value.renewal_rate ===
            Number(
              (BigInt(value.renewal_paid) * 20000n +
                BigInt(value.renewal_due)) /
                (2n * BigInt(value.renewal_due)),
            ) /
              100),
  );
export type AdminSubscriptionPeriod = z.output<
  typeof adminSubscriptionPeriodSchema
>;
const artist = z.strictObject({
  id: z.uuid(),
  slug: artistSlugSchema,
  name: z.string().min(1).max(200),
  status: adminArtistStatusSchema,
});
export const adminSubscriptionDashboardSchema = z
  .strictObject({
    as_of: z.iso.datetime({ offset: true }),
    from: date,
    to: date,
    window_start: z.iso.datetime({ offset: true }),
    window_end: z.iso.datetime({ offset: true }),
    time_zone: z.literal(ADMIN_SUBSCRIPTION_TIME_ZONE),
    cancellation_history_complete_from: z.iso.datetime({ offset: true }),
    selected_artist: artist.nullable(),
    summary: z.strictObject({
      current: adminSubscriptionCurrentSchema,
      period: adminSubscriptionPeriodSchema,
    }),
    artists: z
      .array(
        artist.extend({
          current: adminSubscriptionCurrentSchema,
          period: adminSubscriptionPeriodSchema,
        }),
      )
      .max(ADMIN_SUBSCRIPTIONS.pageSize),
    page,
    page_size: z.literal(ADMIN_SUBSCRIPTIONS.pageSize),
    total_artists: count,
    has_more: z.boolean(),
  })
  .refine(
    (value) =>
      adminSubscriptionQuerySchema.safeParse({
        from: value.from,
        to: value.to,
        artist_id: value.selected_artist?.id ?? null,
        page: value.page,
      }).success &&
      Date.parse(value.window_start) ===
        Date.parse(value.from) - ADMIN_SUBSCRIPTIONS.kstOffsetMs &&
      Date.parse(value.window_end) ===
        Date.parse(value.to) +
          ADMIN_SUBSCRIPTIONS.dayMs -
          ADMIN_SUBSCRIPTIONS.kstOffsetMs &&
      new Set(value.artists.map((row) => row.id)).size ===
        value.artists.length &&
      value.has_more === value.total_artists > value.page * value.page_size &&
      value.artists.length ===
        Math.min(
          value.page_size,
          Math.max(0, value.total_artists - (value.page - 1) * value.page_size),
        ) &&
      (value.selected_artist === null ||
        (value.total_artists === 1 &&
          value.artists.every((row) => row.id === value.selected_artist?.id))),
  );
export type AdminSubscriptionDashboard = z.output<
  typeof adminSubscriptionDashboardSchema
>;
