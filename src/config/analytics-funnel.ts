import { z } from 'zod';
import { AnalyticsEvent } from './analytics-events';

// Technical display/transport bounds only; no business funnel is defined here.
export const ANALYTICS_FUNNEL = {
  actorHeader: 'X-Analytics-Actor',
  timeZone: 'Asia/Seoul',
  maxDays: 366,
  defaultDays: 30,
  dailyPageSize: 13,
  metricSlots: 4,
  earliestDate: '2000-01-01',
  retentionMaxDays: 3650,
  dateLength: 10,
  dayMs: 86_400_000,
  kstOffsetMs: 32_400_000,
  requestTimeoutMs: 15_000,
  responseMaxBytes: 1024 * 1024,
  httpOk: 200,
} as const;
export const ANALYTICS_FUNNEL_ERROR_STATUS = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export type AnalyticsFunnelError = keyof typeof ANALYTICS_FUNNEL_ERROR_STATUS;
export type AnalyticsFunnelResult<T> =
  { ok: true; data: T } | { ok: false; code: AnalyticsFunnelError };
export const ANALYTICS_FUNNEL_EVENTS = Object.values(AnalyticsEvent);
const date = z.iso
  .date()
  .refine((value) => value >= ANALYTICS_FUNNEL.earliestDate);
const count = z.number().int().nonnegative().safe();
const eventName = z.enum(ANALYTICS_FUNNEL_EVENTS);
export const analyticsFunnelQuerySchema = z
  .strictObject({ from: date, to: date })
  .refine(
    (value) =>
      value.from <= value.to &&
      Date.parse(value.to) - Date.parse(value.from) <
        ANALYTICS_FUNNEL.maxDays * ANALYTICS_FUNNEL.dayMs,
  );
export type AnalyticsFunnelQuery = z.output<typeof analyticsFunnelQuerySchema>;
export const analyticsFunnelDashboardSchema = z
  .strictObject({
    actor_id: z.uuid().toLowerCase(),
    as_of: z.iso.datetime({ offset: true }),
    from: date,
    to: date,
    window_start: z.iso.datetime({ offset: true }),
    window_end: z.iso.datetime({ offset: true }),
    time_zone: z.literal(ANALYTICS_FUNNEL.timeZone),
    collection: z.strictObject({
      status: z.enum(['unconfigured', 'disabled', 'enabled']),
      retention_days: count
        .min(1)
        .max(ANALYTICS_FUNNEL.retentionMaxDays)
        .nullable(),
    }),
    coverage: z.strictObject({
      instrumentation_from: z.iso.datetime({ offset: true }),
      history_complete: z.literal(false),
      mode: z.literal('current_consent_observations'),
    }),
    events: z
      .array(z.strictObject({ name: eventName, event_count: count.nullable() }))
      .length(ANALYTICS_FUNNEL_EVENTS.length),
    daily: z
      .array(
        z.strictObject({
          day_kst: date,
          name: eventName,
          event_count: count.min(1),
        }),
      )
      .max(ANALYTICS_FUNNEL.maxDays * ANALYTICS_FUNNEL_EVENTS.length),
    business_metrics: z.strictObject({
      configured: z.literal(false),
      reason: z.literal('definitions_unapproved'),
      expected_count: z.literal(ANALYTICS_FUNNEL.metricSlots),
    }),
  })
  .refine((data) => {
    if (
      !analyticsFunnelQuerySchema.safeParse({ from: data.from, to: data.to })
        .success ||
      Date.parse(data.window_start) !==
        Date.parse(data.from) - ANALYTICS_FUNNEL.kstOffsetMs ||
      Date.parse(data.window_end) !==
        Date.parse(data.to) +
          ANALYTICS_FUNNEL.dayMs -
          ANALYTICS_FUNNEL.kstOffsetMs ||
      data.to >
        new Date(Date.parse(data.as_of) + ANALYTICS_FUNNEL.kstOffsetMs)
          .toISOString()
          .slice(0, ANALYTICS_FUNNEL.dateLength) ||
      Date.parse(data.coverage.instrumentation_from) > Date.parse(data.as_of) ||
      (data.collection.status === 'unconfigured') !==
        (data.collection.retention_days === null)
    )
      return false;
    const names = new Set(data.events.map((event) => event.name));
    if (names.size !== ANALYTICS_FUNNEL_EVENTS.length) return false;
    if (data.collection.status !== 'enabled')
      return (
        data.daily.length === 0 &&
        data.events.every((event) => event.event_count === null)
      );
    const sums = new Map<string, bigint>();
    const rows = new Set<string>();
    for (const row of data.daily) {
      const key = `${row.day_kst}:${row.name}`;
      if (row.day_kst < data.from || row.day_kst > data.to || rows.has(key))
        return false;
      rows.add(key);
      sums.set(row.name, (sums.get(row.name) ?? 0n) + BigInt(row.event_count));
    }
    return data.events.every(
      (event) =>
        event.event_count !== null &&
        BigInt(event.event_count) === (sums.get(event.name) ?? 0n),
    );
  });
export type AnalyticsFunnelDashboard = z.output<
  typeof analyticsFunnelDashboardSchema
>;
