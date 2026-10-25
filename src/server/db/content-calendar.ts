import 'server-only';
import { z } from 'zod';
import {
  CONTENT_CALENDAR,
  contentCalendarDateSchema,
  contentCalendarEntrySchema,
  contentCalendarDeletedSchema,
  artistContentCalendarSchema,
  adminContentCalendarSchema,
  type ContentCalendarError,
  type ContentCalendarResult,
} from '@/config/content-calendar';
import { artistReplyActivityWeekSchema } from '@/config/artist-reply-activity';
import type { ContentCalendarReadPort } from '@/server/services/content-calendar/read';
import type { ContentCalendarWritePort } from '@/server/services/content-calendar/manage';
import type { ActorClient } from './client';

const errors: Record<string, ContentCalendarError> = {
  CONTENT_CALENDAR_INVALID_INPUT: 'INVALID_INPUT',
  CONTENT_CALENDAR_REVISION_CONFLICT: 'CONFLICT',
  CONTENT_CALENDAR_OPERATION_CONFLICT: 'CONFLICT',
  CONTENT_CALENDAR_DATE_CONFLICT: 'DATE_CONFLICT',
  CONTENT_CALENDAR_ENTRY_UNAVAILABLE: 'NOT_FOUND',
  CONTENT_CALENDAR_CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  CALENDAR_FORBIDDEN: 'FORBIDDEN',
  CALENDAR_ARTIST_UNAVAILABLE: 'ARTIST_UNAVAILABLE',
  CALENDAR_INVALID_MONTH: 'INVALID_INPUT',
  ARTIST_REPLY_FORBIDDEN: 'FORBIDDEN',
  ARTIST_REPLY_NOT_FOUND: 'NOT_FOUND',
  ARTIST_REPLY_INVALID_INPUT: 'INVALID_INPUT',
};
function parsed<T>(
  schema: z.ZodType<T>,
  data: unknown,
  error: { message: string } | null,
): ContentCalendarResult<T> {
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
const activitySchema = z
  .strictObject({
    week_start: z.unknown(),
    week_end: z.unknown(),
    message_count: z.unknown(),
    photo_count: z.unknown(),
    weekly_message_min: z.unknown(),
    weekly_photo_min: z.unknown(),
    requirements_ready: z.unknown(),
  })
  .transform((row) => ({
    weekStart: row.week_start,
    weekEnd: row.week_end,
    messageCount: row.message_count,
    photoCount: row.photo_count,
    weeklyMessageMin: row.weekly_message_min,
    weeklyPhotoMin: row.weekly_photo_min,
    requirementsReady: row.requirements_ready,
  }))
  .pipe(artistReplyActivityWeekSchema);
const monthSchema = contentCalendarDateSchema
  .refine((value) => value.endsWith('-01'))
  .transform((value) => value.slice(0, CONTENT_CALENDAR.monthLength));
const rawPage = z
  .strictObject({
    artist: z.unknown(),
    month: monthSchema,
    server_now: z.unknown(),
    entries: z
      .array(contentCalendarEntrySchema)
      .max(CONTENT_CALENDAR.maxEntries),
    activity: activitySchema,
  })
  .transform((row) => ({
    artist: row.artist,
    month: row.month,
    serverNow: row.server_now,
    entries: row.entries,
    activity: row.activity,
  }));

export function createContentCalendarPort(
  client: ActorClient,
): ContentCalendarReadPort & ContentCalendarWritePort {
  return {
    async artist(query) {
      const { data, error } = await client.rpc(
        'content_calendar_artist_context',
        {
          p_artist_slug: query.slug,
          p_month: `${query.month}-01`,
        },
      );
      return parsed(rawPage.pipe(artistContentCalendarSchema), data, error);
    },
    async admin(query) {
      const { data, error } = await client.rpc('content_calendar_admin_list', {
        p_artist_id: query.artist_id,
        p_month: `${query.month}-01`,
      });
      return parsed(rawPage.pipe(adminContentCalendarSchema), data, error);
    },
    async save(input) {
      const { data, error } = await client.rpc('content_calendar_admin_save', {
        p_operation_id: input.operation_id,
        ...(input.entry_id === null ? {} : { p_entry_id: input.entry_id }),
        ...(input.expected_revision === null
          ? {}
          : { p_expected_revision: input.expected_revision }),
        p_input: input.input,
      });
      return parsed(contentCalendarEntrySchema, data, error);
    },
    async delete(input) {
      const { data, error } = await client.rpc(
        'content_calendar_admin_delete',
        {
          p_operation_id: input.operation_id,
          p_entry_id: input.entry_id,
          p_expected_revision: input.expected_revision,
          p_confirmed: input.confirmed,
        },
      );
      return parsed(contentCalendarDeletedSchema, data, error);
    },
  };
}
