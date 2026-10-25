import { z } from 'zod';
import { scheduleInstantMicroseconds } from '@/lib/schedule-time';
import { artistSlugSchema } from './artists';
import { adminArtistStatusSchema } from './admin-artists';

// Technical transport/schema limits only. No scheduling or subscription policy.
export const SCHEDULES = {
  timeZone: 'Asia/Seoul',
  actorHeader: 'X-Schedule-Actor',
  pageSize: 100,
  adminPageSize: 30,
  maxPage: 1000,
  requestTimeoutMs: 15_000,
  responseMaxBytes: 64 * 1024 * 1024,
  titleMax: 1000,
  descriptionMax: 100000,
  placeMax: 2000,
  bodyLimit: 512 * 1024,
  bodyTimeoutMs: 5000,
  cursorMax: 512,
  // PostgreSQL JSON BC dates are not four-digit ISO-8601 UTC instants.
  minInstant: '0001-01-01T00:00:00Z',
  maxInstant: '9999-12-31T15:00:00Z',
  minMonth: '0001-01',
  maxMonth: '9999-12',
  monthLength: 7,
  dateLength: 10,
  kstOffsetMs: 32_400_000,
  dayMs: 86_400_000,
  httpOk: 200,
  minLatitude: -90,
  maxLatitude: 90,
  minLongitude: -180,
  maxLongitude: 180,
} as const;
export const SCHEDULE_MAPS = {
  kakaoBase: 'https://map.kakao.com/link/map/',
  naverBase: 'nmap://map',
  naverMinLatitude: 31.43,
  naverMaxLatitude: 44.35,
  naverMinLongitude: 122.37,
  naverMaxLongitude: 132,
} as const;
export const SCHEDULE_ERROR_STATUS = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  CONFIRMATION_REQUIRED: 400,
  ARTIST_UNAVAILABLE: 409,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export type ScheduleError = keyof typeof SCHEDULE_ERROR_STATUS;
export type ScheduleResult<T> =
  { ok: true; data: T } | { ok: false; code: ScheduleError };
export const scheduleMonthSchema = z
  .string()
  .regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/);
export const scheduleTypeSchema = z.enum([
  'broadcast',
  'concert',
  'event',
  'festival',
]);
export const scheduleStatusSchema = z.enum(['draft', 'published']);
// PostgreSQL wire timestamps are offset-aware, second-based, and at most six
// fractional digits. Reject unsupported precision rather than silently round.
const timestamp = z.iso
  .datetime({ offset: true })
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/,
  )
  .refine((value) => {
    const instant = scheduleInstantMicroseconds(value);
    return (
      instant !== null &&
      instant >= scheduleInstantMicroseconds(SCHEDULES.minInstant)!
    );
  });
function validInterval(value: { starts_at: string; ends_at: string | null }) {
  const start = scheduleInstantMicroseconds(value.starts_at);
  const end =
    value.ends_at === null ? null : scheduleInstantMicroseconds(value.ends_at);
  const maximum = scheduleInstantMicroseconds(SCHEDULES.maxInstant)!;
  return (
    start !== null &&
    start < maximum &&
    (value.ends_at === null || (end !== null && end > start && end <= maximum))
  );
}
const title = z.string().trim().min(1).max(SCHEDULES.titleMax);
const nullableText = (max: number) => z.string().max(max).nullable();
const latitude = z
  .number()
  .min(SCHEDULES.minLatitude)
  .max(SCHEDULES.maxLatitude)
  .nullable();
const longitude = z
  .number()
  .min(SCHEDULES.minLongitude)
  .max(SCHEDULES.maxLongitude)
  .nullable();
export const scheduleEventSchema = z
  .strictObject({
    id: z.uuid(),
    artist_id: z.uuid(),
    artist_slug: artistSlugSchema,
    artist_name: z.string().min(1),
    type: scheduleTypeSchema,
    title,
    description: nullableText(SCHEDULES.descriptionMax),
    starts_at: timestamp,
    ends_at: timestamp.nullable(),
    place_name: nullableText(SCHEDULES.placeMax),
    address: nullableText(SCHEDULES.placeMax),
    lat: latitude,
    lng: longitude,
    created_at: timestamp,
    updated_at: timestamp,
  })
  .refine(
    (value) =>
      (value.lat === null) === (value.lng === null) && validInterval(value),
  );
export type ScheduleEvent = z.output<typeof scheduleEventSchema>;
export const adminScheduleSchema = scheduleEventSchema.safeExtend({
  status: scheduleStatusSchema,
  artist_status: adminArtistStatusSchema,
  revision: z.number().int().positive().safe(),
});
export type AdminSchedule = z.output<typeof adminScheduleSchema>;
export const scheduleQuerySchema = z.strictObject({
  month: scheduleMonthSchema,
  cursor: z.string().min(1).max(SCHEDULES.cursorMax).nullable(),
});
export type ScheduleQuery = z.output<typeof scheduleQuerySchema>;
export const adminScheduleQuerySchema = z.strictObject({
  month: scheduleMonthSchema,
  page: z.number().int().min(1).max(SCHEDULES.maxPage),
});
export type AdminScheduleQuery = z.output<typeof adminScheduleQuerySchema>;
export const scheduleListSchema = z.strictObject({
  month: scheduleMonthSchema,
  items: z.array(scheduleEventSchema).max(SCHEDULES.pageSize),
  nextCursor: z.string().max(SCHEDULES.cursorMax).nullable(),
  myArtistIds: z.array(z.uuid()),
});
export type ScheduleList = z.output<typeof scheduleListSchema>;
export const adminScheduleListSchema = z.strictObject({
  month: scheduleMonthSchema,
  page: z.number().int().positive(),
  page_size: z.literal(SCHEDULES.adminPageSize),
  has_more: z.boolean(),
  items: z.array(adminScheduleSchema).max(SCHEDULES.adminPageSize),
});
export type AdminScheduleList = z.output<typeof adminScheduleListSchema>;
export const scheduleCursorSchema = z.strictObject({
  month: scheduleMonthSchema,
  starts_at: timestamp,
  id: z.uuid(),
});
export type ScheduleCursor = z.output<typeof scheduleCursorSchema>;
const inputText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
export const adminScheduleInputSchema = z
  .strictObject({
    artist_id: z.uuid(),
    type: scheduleTypeSchema,
    status: scheduleStatusSchema,
    title: inputText(SCHEDULES.titleMax),
    description: z
      .string()
      .max(SCHEDULES.descriptionMax)
      .refine(
        (value) =>
          !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
      )
      .nullable(),
    starts_at: timestamp,
    ends_at: timestamp.nullable(),
    place_name: inputText(SCHEDULES.placeMax).nullable(),
    address: inputText(SCHEDULES.placeMax).nullable(),
    lat: latitude,
    lng: longitude,
  })
  .refine(
    (value) =>
      (value.lat === null) === (value.lng === null) && validInterval(value),
  );
export type AdminScheduleInput = z.output<typeof adminScheduleInputSchema>;
export const adminScheduleSaveSchema = z
  .strictObject({
    operation_id: z.uuid(),
    schedule_id: z.uuid().nullable(),
    expected_revision: z.number().int().positive().safe().nullable(),
    input: adminScheduleInputSchema,
    confirmed: z.boolean(),
  })
  .refine(
    (value) =>
      (value.schedule_id === null) === (value.expected_revision === null),
  );
export type AdminScheduleSaveInput = z.output<typeof adminScheduleSaveSchema>;
export const adminScheduleDeleteSchema = z.strictObject({
  operation_id: z.uuid(),
  schedule_id: z.uuid(),
  expected_revision: z.number().int().positive().safe(),
  confirmed: z.literal(true),
});
export type AdminScheduleDeleteInput = z.output<
  typeof adminScheduleDeleteSchema
>;
export const adminScheduleDeletedSchema = z.strictObject({
  id: z.uuid(),
  deleted: z.literal(true),
});
export type AdminScheduleDeleted = z.output<typeof adminScheduleDeletedSchema>;
