import { z } from 'zod';
import type { ScheduleError, ScheduleResult } from './schedules';

// Technical request and worker ceilings; business timing only comes from an
// explicitly approved DB policy. No scheduler or delivery is activated here.
export const SCHEDULE_NOTICE = {
  scanLimit: 20,
  workerPages: 5,
  workerLimit: 100,
  workerBudgetMs: 40_000,
  databaseTimeoutMs: 5000,
  bodyTimeoutMs: 1000,
  bodyLimit: 512,
  requestTimeoutMs: 15_000,
  responseMaxBytes: 64 * 1024,
  secretMinLength: 32,
  secretMaxLength: 256,
} as const;
export const SCHEDULE_NOTICE_CRON_STATUS = {
  OK: 200,
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export type ScheduleNoticeError = ScheduleError;
export type ScheduleNoticeResult<T> = ScheduleResult<T>;
export const scheduleNoticeStateSchema = z
  .strictObject({
    scheduleEnabled: z.boolean(),
    eventEnabled: z.boolean().nullable(),
    eligible: z.boolean().nullable(),
    webpushEnabled: z.boolean(),
    configured: z.boolean(),
    hourKst: z.number().int().min(0).max(23).nullable(),
  })
  .refine(
    (state) =>
      state.configured === (state.hourKst !== null) &&
      (state.eventEnabled === null) === (state.eligible === null),
  );
export type ScheduleNoticeState = z.output<typeof scheduleNoticeStateSchema>;
export const scheduleNoticeQuerySchema = z.strictObject({
  scheduleId: z.uuid().nullable(),
});
export const scheduleNoticePreferenceInputSchema = z.strictObject({
  enabled: z.boolean(),
});
export const scheduleNoticeEventInputSchema = z.strictObject({
  scheduleId: z.uuid(),
  enabled: z.boolean(),
});
export const scheduleNoticeCreatedSchema = z
  .strictObject({
    created: z.boolean(),
    pushJobs: z.number().int().nonnegative().max(2147483647),
  })
  .refine((value) => value.created === value.pushJobs > 0);
export type ScheduleNoticeCreated = z.output<
  typeof scheduleNoticeCreatedSchema
>;
export const scheduleNoticeWorkerSummarySchema = z
  .strictObject({
    examined: z.number().int().nonnegative().max(SCHEDULE_NOTICE.workerLimit),
    created: z.number().int().nonnegative().max(SCHEDULE_NOTICE.workerLimit),
    skipped: z.number().int().nonnegative().max(SCHEDULE_NOTICE.workerLimit),
    failed: z.number().int().nonnegative().max(SCHEDULE_NOTICE.workerLimit),
    pushJobsQueued: z
      .number()
      .int()
      .nonnegative()
      .max(SCHEDULE_NOTICE.workerLimit * 2147483647),
    hasMore: z.boolean(),
  })
  .refine(
    (summary) =>
      summary.created + summary.skipped + summary.failed === summary.examined,
  );
export type ScheduleNoticeWorkerSummary = z.output<
  typeof scheduleNoticeWorkerSummarySchema
>;
