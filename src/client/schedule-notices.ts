import { z } from 'zod';
import {
  SCHEDULES,
  SCHEDULE_ERROR_STATUS,
  type ScheduleResult,
  type ScheduleError,
} from '@/config/schedules';
import {
  SCHEDULE_NOTICE,
  scheduleNoticeStateSchema,
  scheduleNoticeQuerySchema,
  scheduleNoticePreferenceInputSchema,
  scheduleNoticeEventInputSchema,
  type ScheduleNoticeState,
} from '@/config/schedule-notices';
import { routes } from '@/config/routes';

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
    const timeout = AbortSignal.timeout(SCHEDULE_NOTICE.requestTimeoutMs);
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
        if (bytes > SCHEDULE_NOTICE.responseMaxBytes) {
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

async function bound(
  result: Promise<ScheduleResult<ScheduleNoticeState>>,
  event: boolean,
  matches: (state: ScheduleNoticeState) => boolean = () => true,
) {
  const value = await result;
  return value.ok &&
    ((value.data.eventEnabled !== null) !== event || !matches(value.data))
    ? { ok: false as const, code: 'UNAVAILABLE' as const }
    : value;
}
export function fetchScheduleNoticePreferences(
  scheduleId: string | null,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = scheduleNoticeQuerySchema.safeParse({ scheduleId });
  return parsed.success
    ? bound(
        request(
          `${routes.scheduleNoticeStatus}${scheduleId === null ? '' : `?${new URLSearchParams({ id: scheduleId })}`}`,
          scheduleNoticeStateSchema,
          undefined,
          signal,
          actorKey,
        ),
        scheduleId !== null,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function saveScheduleNoticePreference(
  enabled: boolean,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = scheduleNoticePreferenceInputSchema.safeParse({ enabled });
  return parsed.success
    ? bound(
        request(
          routes.scheduleNoticePreference,
          scheduleNoticeStateSchema,
          parsed.data,
          signal,
          actorKey,
        ),
        false,
        (state) => state.scheduleEnabled === parsed.data.enabled,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function saveScheduleNoticeEvent(
  scheduleId: string,
  enabled: boolean,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = scheduleNoticeEventInputSchema.safeParse({
    scheduleId,
    enabled,
  });
  return parsed.success
    ? bound(
        request(
          routes.scheduleNoticeEvent,
          scheduleNoticeStateSchema,
          parsed.data,
          signal,
          actorKey,
        ),
        true,
        (state) => state.eventEnabled === parsed.data.enabled,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
