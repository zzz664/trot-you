import 'server-only';
import { z } from 'zod';
import {
  SCHEDULES,
  scheduleEventSchema,
  adminScheduleSchema,
  adminScheduleListSchema,
  adminScheduleDeletedSchema,
  type ScheduleError,
  type ScheduleResult,
} from '@/config/schedules';
import type { ScheduleReadPort } from '@/server/services/schedules/read';
import type { ScheduleWritePort } from '@/server/services/schedules/manage';
import type { ActorClient } from './client';
const errors: Record<string, ScheduleError> = {
  CALENDAR_FORBIDDEN: 'FORBIDDEN',
  SCHEDULE_INVALID_INPUT: 'INVALID_INPUT',
  SCHEDULE_CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  SCHEDULE_OPERATION_CONFLICT: 'CONFLICT',
  SCHEDULE_REVISION_CONFLICT: 'CONFLICT',
  SCHEDULE_UNAVAILABLE: 'NOT_FOUND',
  CALENDAR_ARTIST_UNAVAILABLE: 'ARTIST_UNAVAILABLE',
  CALENDAR_INVALID_MONTH: 'INVALID_INPUT',
  SCHEDULE_INVALID_FILTER: 'INVALID_INPUT',
};
function parsed<T>(
  schema: z.ZodType<T>,
  data: unknown,
  error: { message: string } | null,
): ScheduleResult<T> {
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
export function createSchedulePort(
  client: ActorClient,
): ScheduleReadPort & ScheduleWritePort {
  return {
    async list(month, cursor) {
      const { data, error } = await client.rpc('schedule_list', {
        p_month: `${month}-01`,
        p_limit: SCHEDULES.pageSize,
        ...(cursor
          ? { p_after_starts_at: cursor.starts_at, p_after_id: cursor.id }
          : {}),
      });
      return parsed(
        z.array(scheduleEventSchema).max(SCHEDULES.pageSize),
        data,
        error,
      );
    },
    async detail(id) {
      const { data, error } = await client
        .rpc('schedule_get', { p_schedule_id: id })
        .single();
      const result = parsed(scheduleEventSchema, data, error);
      return result.ok && result.data.id !== id
        ? { ok: false, code: 'UNAVAILABLE' }
        : result;
    },
    async myArtists() {
      const { data, error } = await client.rpc('schedule_my_artists');
      return parsed(z.array(z.uuid()), data, error);
    },
    async adminList(query) {
      const { data, error } = await client.rpc('schedule_admin_list', {
        p_month: `${query.month}-01`,
        p_page: query.page,
      });
      // SQL month is a calendar date; HTTP/UI carries the YYYY-MM route value.
      const normalized =
        typeof data === 'object' && data !== null && !Array.isArray(data)
          ? {
              ...data,
              month:
                typeof data.month === 'string'
                  ? data.month.slice(0, SCHEDULES.monthLength)
                  : data.month,
            }
          : data;
      const result = parsed(adminScheduleListSchema, normalized, error);
      return result.ok &&
        (result.data.month !== query.month || result.data.page !== query.page)
        ? { ok: false, code: 'UNAVAILABLE' }
        : result;
    },
    async adminDetail(id) {
      const { data, error } = await client.rpc('schedule_admin_get', {
        p_schedule_id: id,
      });
      const result = parsed(adminScheduleSchema, data, error);
      return result.ok && result.data.id !== id
        ? { ok: false, code: 'UNAVAILABLE' }
        : result;
    },
    async save(input) {
      const { data, error } = await client.rpc('schedule_admin_save', {
        p_operation_id: input.operation_id,
        ...(input.schedule_id === null
          ? {}
          : { p_schedule_id: input.schedule_id }),
        ...(input.expected_revision === null
          ? {}
          : { p_expected_revision: input.expected_revision }),
        p_input: input.input,
        p_confirmed: input.confirmed,
      });
      const result = parsed(adminScheduleSchema, data, error);
      return result.ok &&
        input.schedule_id !== null &&
        result.data.id !== input.schedule_id
        ? { ok: false, code: 'UNAVAILABLE' }
        : result;
    },
    async delete(input) {
      const { data, error } = await client.rpc('schedule_admin_delete', {
        p_operation_id: input.operation_id,
        p_schedule_id: input.schedule_id,
        p_expected_revision: input.expected_revision,
        p_confirmed: input.confirmed,
      });
      const result = parsed(adminScheduleDeletedSchema, data, error);
      return result.ok && result.data.id !== input.schedule_id
        ? { ok: false, code: 'UNAVAILABLE' }
        : result;
    },
  };
}
