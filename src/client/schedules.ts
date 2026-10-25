import { z } from 'zod';
import { ADMIN_ARTISTS, adminArtistListSchema } from '@/config/admin-artists';
import {
  SCHEDULES,
  SCHEDULE_ERROR_STATUS,
  scheduleEventSchema,
  scheduleListSchema,
  scheduleQuerySchema,
  adminScheduleQuerySchema,
  adminScheduleSchema,
  adminScheduleListSchema,
  adminScheduleSaveSchema,
  adminScheduleDeleteSchema,
  adminScheduleDeletedSchema,
  type ScheduleResult,
  type ScheduleError,
  type ScheduleQuery,
  type AdminScheduleQuery,
  type AdminScheduleSaveInput,
  type AdminScheduleDeleteInput,
} from '@/config/schedules';
import {
  routes,
  scheduleListPath,
  adminScheduleListPath,
  adminScheduleApiPath,
} from '@/config/routes';

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  signal?: AbortSignal,
  actorKey?: string,
): Promise<ScheduleResult<T>> {
  if (actorKey !== undefined && !z.uuid().safeParse(actorKey).success)
    return { ok: false, code: 'FORBIDDEN' };
  if (signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
  try {
    const timeout = AbortSignal.timeout(SCHEDULES.requestTimeoutMs);
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(actorKey ? { [SCHEDULES.actorHeader]: actorKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (
      response.headers.get('content-type')?.split(';')[0]?.trim() !==
      'application/json'
    )
      return { ok: false, code: 'UNAVAILABLE' };
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, code: 'UNAVAILABLE' };
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    let text = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > SCHEDULES.responseMaxBytes) {
          await reader.cancel();
          return { ok: false, code: 'UNAVAILABLE' };
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const parsed = z
      .union([
        z.strictObject({ ok: z.literal(true), data: schema }),
        z.strictObject({ ok: z.literal(false), code: z.string() }),
      ])
      .safeParse(JSON.parse(text));
    if (!parsed.success) return { ok: false, code: 'UNAVAILABLE' };
    if (parsed.data.ok)
      return response.status === SCHEDULES.httpOk
        ? parsed.data
        : { ok: false, code: 'UNAVAILABLE' };
    if (Object.hasOwn(SCHEDULE_ERROR_STATUS, parsed.data.code)) {
      const code = parsed.data.code as ScheduleError;
      if (response.status === SCHEDULE_ERROR_STATUS[code])
        return { ok: false, code };
    }
  } catch {
    // Settings values, identifiers and session data are never logged.
  }
  return { ok: false, code: 'UNAVAILABLE' };
}

async function bound<T>(
  result: Promise<ScheduleResult<T>>,
  matches: (data: T) => boolean,
): Promise<ScheduleResult<T>> {
  const value = await result;
  return value.ok && !matches(value.data)
    ? { ok: false, code: 'UNAVAILABLE' }
    : value;
}
export function fetchSchedules(
  query: ScheduleQuery,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = scheduleQuerySchema.safeParse(query);
  return parsed.success
    ? bound(
        request(
          scheduleListPath(parsed.data.month, parsed.data.cursor, true),
          scheduleListSchema,
          undefined,
          signal,
          actorKey,
        ),
        (data) => data.month === parsed.data.month,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function fetchSchedule(
  id: string,
  signal?: AbortSignal,
  actorKey?: string,
) {
  return z.uuid().safeParse(id).success
    ? bound(
        request(
          `${routes.schedulesApi}?${new URLSearchParams({ id })}`,
          scheduleEventSchema,
          undefined,
          signal,
          actorKey,
        ),
        (data) => data.id === id,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function fetchAdminSchedules(
  query: AdminScheduleQuery,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = adminScheduleQuerySchema.safeParse(query);
  return parsed.success
    ? bound(
        request(
          adminScheduleListPath(parsed.data.month, parsed.data.page, true),
          adminScheduleListSchema,
          undefined,
          signal,
          actorKey,
        ),
        (data) =>
          data.month === parsed.data.month && data.page === parsed.data.page,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function fetchAdminSchedule(
  id: string,
  signal?: AbortSignal,
  actorKey?: string,
) {
  return z.uuid().safeParse(id).success
    ? bound(
        request(
          `${routes.adminSchedulesApi}?${new URLSearchParams({ id })}`,
          adminScheduleSchema,
          undefined,
          signal,
          actorKey,
        ),
        (data) => data.id === id,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function saveAdminSchedule(
  input: AdminScheduleSaveInput,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = adminScheduleSaveSchema.safeParse(input);
  return parsed.success
    ? bound(
        request(
          adminScheduleApiPath('save'),
          adminScheduleSchema,
          parsed.data,
          signal,
          actorKey,
        ),
        (data) =>
          parsed.data.schedule_id === null ||
          data.id === parsed.data.schedule_id,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function deleteAdminSchedule(
  input: AdminScheduleDeleteInput,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = adminScheduleDeleteSchema.safeParse(input);
  return parsed.success
    ? bound(
        request(
          adminScheduleApiPath('delete'),
          adminScheduleDeletedSchema,
          parsed.data,
          signal,
          actorKey,
        ),
        (data) => data.id === parsed.data.schedule_id,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}

export function fetchScheduleArtists(
  page: number,
  signal?: AbortSignal,
  actorKey?: string,
) {
  return Number.isSafeInteger(page) &&
    page >= 1 &&
    page <= ADMIN_ARTISTS.maxPage
    ? request(
        `${routes.adminSchedulesApi}?${new URLSearchParams({ artists: '1', page: String(page) })}`,
        adminArtistListSchema,
        undefined,
        signal,
        actorKey,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
