import { z } from 'zod';
import { artistSlugSchema } from './artists';
import { composeArtistSchema } from './artist-compose';
import { adminArtistStatusSchema } from './admin-artists';
import { artistReplyActivityWeekSchema } from './artist-reply-activity';
import { scheduleMonthSchema } from './schedules';

// Schema/transport ceilings only; this feature does not define activity policy.
export const CONTENT_CALENDAR = {
  actorHeader: 'X-Content-Calendar-Actor',
  monthLength: 7,
  maxEntries: 31,
  topicMax: 1000,
  exampleMax: 100000,
  bodyLimit: 512 * 1024,
  bodyTimeoutMs: 5000,
  requestTimeoutMs: 15000,
  responseMaxBytes: 32 * 1024 * 1024,
  httpOk: 200,
  maxMutableRevision: Number.MAX_SAFE_INTEGER - 1,
} as const;
export const CONTENT_CALENDAR_ERROR_STATUS = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DATE_CONFLICT: 409,
  CONFIRMATION_REQUIRED: 400,
  ARTIST_UNAVAILABLE: 409,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export type ContentCalendarError = keyof typeof CONTENT_CALENDAR_ERROR_STATUS;
export type ContentCalendarResult<T> =
  { ok: true; data: T } | { ok: false; code: ContentCalendarError };
export const contentCalendarMonthSchema = scheduleMonthSchema;
export const contentCalendarDateSchema = z.iso
  .date()
  .regex(/^(?!0000)\d{4}-\d{2}-\d{2}$/);
const instant = z.iso.datetime({ offset: true });
const revision = z.number().int().positive().safe();
// PostgreSQL length(text) counts Unicode code points, not JavaScript UTF-16 units.
const topic = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      Array.from(value).length <= CONTENT_CALENDAR.topicMax &&
      !/[\p{Cc}\p{Cs}]/u.test(value),
  );
const example = z
  .string()
  .refine(
    (value) =>
      Array.from(value).length <= CONTENT_CALENDAR.exampleMax &&
      !/[\p{Cc}\p{Cs}]/u.test(value.replace(/[\n\r\t]/g, '')),
  )
  .nullable();
export const contentCalendarInputSchema = z.strictObject({
  artist_id: z.uuid(),
  date: contentCalendarDateSchema,
  topic,
  example_text: example,
});
export type ContentCalendarInput = z.output<typeof contentCalendarInputSchema>;
export const contentCalendarEntrySchema = z.strictObject({
  artist_id: z.uuid(),
  date: contentCalendarDateSchema,
  // Existing editorial records retain their original whitespace and controls;
  // stricter authoring validation must not mutate or hide migrated records.
  // PostgreSQL POSIX whitespace depends on DB locale; JS Unicode trim/\S
  // would incorrectly hide some valid legacy topics (for example NBSP).
  topic: z
    .string()
    .refine(
      (value) =>
        value.length > 0 &&
        Array.from(value).length <= CONTENT_CALENDAR.topicMax,
    ),
  example_text: z
    .string()
    .refine((value) => Array.from(value).length <= CONTENT_CALENDAR.exampleMax)
    .nullable(),
  id: z.uuid(),
  revision,
  created_at: instant,
  updated_at: instant,
});
export type ContentCalendarEntry = z.output<typeof contentCalendarEntrySchema>;
const pageFields = {
  month: contentCalendarMonthSchema,
  serverNow: instant,
  entries: z.array(contentCalendarEntrySchema).max(CONTENT_CALENDAR.maxEntries),
  activity: artistReplyActivityWeekSchema,
};
function consistentCalendarPage(value: {
  artist: { id: string };
  month: string;
  entries: ContentCalendarEntry[];
}) {
  let previousDate = '';
  const ids = new Set<string>();
  for (const entry of value.entries) {
    if (
      entry.artist_id !== value.artist.id ||
      entry.date.slice(0, CONTENT_CALENDAR.monthLength) !== value.month ||
      entry.date <= previousDate ||
      ids.has(entry.id)
    )
      return false;
    previousDate = entry.date;
    ids.add(entry.id);
  }
  return true;
}
export const artistContentCalendarSchema = z
  .strictObject({
    artist: composeArtistSchema,
    ...pageFields,
  })
  .refine(consistentCalendarPage);
export type ArtistContentCalendar = z.output<
  typeof artistContentCalendarSchema
>;
export const adminContentCalendarSchema = z
  .strictObject({
    artist: composeArtistSchema.extend({ status: adminArtistStatusSchema }),
    ...pageFields,
  })
  .refine(consistentCalendarPage);
export type AdminContentCalendar = z.output<typeof adminContentCalendarSchema>;
export const artistContentCalendarQuerySchema = z.strictObject({
  slug: artistSlugSchema,
  month: contentCalendarMonthSchema,
});
export type ArtistContentCalendarQuery = z.output<
  typeof artistContentCalendarQuerySchema
>;
export const adminContentCalendarQuerySchema = z.strictObject({
  artist_id: z.uuid(),
  month: contentCalendarMonthSchema,
});
export type AdminContentCalendarQuery = z.output<
  typeof adminContentCalendarQuerySchema
>;
export const contentCalendarSaveSchema = z
  .strictObject({
    operation_id: z.uuid(),
    entry_id: z.uuid().nullable(),
    expected_revision: revision
      .max(CONTENT_CALENDAR.maxMutableRevision)
      .nullable(),
    input: contentCalendarInputSchema,
  })
  .refine(
    (value) => (value.entry_id === null) === (value.expected_revision === null),
  );
export type ContentCalendarSaveInput = z.output<
  typeof contentCalendarSaveSchema
>;
export const contentCalendarDeleteSchema = z.strictObject({
  operation_id: z.uuid(),
  entry_id: z.uuid(),
  expected_revision: revision,
  confirmed: z.literal(true),
});
export type ContentCalendarDeleteInput = z.output<
  typeof contentCalendarDeleteSchema
>;
export const contentCalendarDeletedSchema = z.strictObject({
  id: z.uuid(),
  deleted: z.literal(true),
});
export type ContentCalendarDeleted = z.output<
  typeof contentCalendarDeletedSchema
>;
