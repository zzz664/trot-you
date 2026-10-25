import 'server-only';
import { z } from 'zod';
import {
  scheduleNoticeStateSchema,
  type ScheduleNoticeResult,
  type ScheduleNoticeState,
  type ScheduleNoticeError,
} from '@/config/schedule-notices';
import type { ScheduleNoticePreferencePort } from '@/server/services/schedule-notices/preferences';
import type { ActorClient } from './client';

const errors: Record<string, ScheduleNoticeError> = {
  CALENDAR_FORBIDDEN: 'FORBIDDEN',
  CALENDAR_ARTIST_UNAVAILABLE: 'ARTIST_UNAVAILABLE',
  SCHEDULE_NOTIFICATION_REQUIRED: 'INVALID_INPUT',
  NOTIFICATION_ACTOR_FORBIDDEN: 'FORBIDDEN',
  NOTIFICATION_PREFERENCES_REQUIRED: 'INVALID_INPUT',
  SCHEDULE_NOTICE_INVALID_INPUT: 'INVALID_INPUT',
  SCHEDULE_NOTICE_UNAVAILABLE: 'NOT_FOUND',
  SCHEDULE_UNAVAILABLE: 'NOT_FOUND',
};
const stateSchema = z
  .array(
    z
      .object({
        schedule_enabled: z.boolean(),
        event_enabled: z.boolean().nullable(),
        eligible: z.boolean().nullable(),
        webpush_enabled: z.boolean(),
        configured: z.boolean(),
        hour_kst: z.number().nullable(),
      })
      .transform((row) => ({
        scheduleEnabled: row.schedule_enabled,
        eventEnabled: row.event_enabled,
        eligible: row.eligible,
        webpushEnabled: row.webpush_enabled,
        configured: row.configured,
        hourKst: row.hour_kst,
      }))
      .pipe(scheduleNoticeStateSchema),
  )
  .length(1)
  .transform((rows) => rows[0]!);
function parsed(
  data: unknown,
  error: { message: string } | null,
): ScheduleNoticeResult<ScheduleNoticeState> {
  if (error)
    return {
      ok: false,
      code: Object.hasOwn(errors, error.message)
        ? errors[error.message]!
        : 'UNAVAILABLE',
    };
  const result = stateSchema.safeParse(data);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, code: 'UNAVAILABLE' };
}
export function createScheduleNoticePreferencePort(
  client: ActorClient,
): ScheduleNoticePreferencePort {
  return {
    async preferences(scheduleId) {
      const { data, error } = await client.rpc(
        'schedule_notice_preferences',
        scheduleId === null ? {} : { p_schedule_id: scheduleId },
      );
      return parsed(data, error);
    },
    async setPreference(enabled) {
      const { data, error } = await client.rpc(
        'schedule_notice_set_preference',
        { p_enabled: enabled },
      );
      return parsed(data, error);
    },
    async setEvent(scheduleId, enabled) {
      const { data, error } = await client.rpc('schedule_notice_set_event', {
        p_schedule_id: scheduleId,
        p_enabled: enabled,
      });
      return parsed(data, error);
    },
  };
}
