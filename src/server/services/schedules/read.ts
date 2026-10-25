import 'server-only';
import { z } from 'zod';
import { scheduleMonthAt } from '@/lib/schedule-view';
import {
  SCHEDULES,
  scheduleQuerySchema,
  scheduleMonthSchema,
  scheduleCursorSchema,
  adminScheduleQuerySchema,
  type ScheduleQuery,
  type ScheduleCursor,
  type ScheduleEvent,
  type ScheduleList,
  type ScheduleResult,
  type AdminSchedule,
  type AdminScheduleList,
  type AdminScheduleQuery,
} from '@/config/schedules';
export type ScheduleReadPort = {
  list(
    month: string,
    cursor: ScheduleCursor | null,
  ): Promise<ScheduleResult<ScheduleEvent[]>>;
  detail(id: string): Promise<ScheduleResult<ScheduleEvent>>;
  myArtists(): Promise<ScheduleResult<string[]>>;
  adminList(
    query: AdminScheduleQuery,
  ): Promise<ScheduleResult<AdminScheduleList>>;
  adminDetail(id: string): Promise<ScheduleResult<AdminSchedule>>;
};
export function resolveScheduleQuery(
  input: unknown,
  now = new Date(),
): ScheduleResult<ScheduleQuery> {
  const parsed = z
    .strictObject({
      month: scheduleMonthSchema.optional(),
      cursor: z.string().max(SCHEDULES.cursorMax).optional(),
    })
    .safeParse(input);
  if (!parsed.success || !Number.isFinite(now.getTime()))
    return { ok: false, code: 'INVALID_INPUT' };
  const query = scheduleQuerySchema.safeParse({
    month: parsed.data.month ?? scheduleMonthAt(now),
    cursor: parsed.data.cursor ?? null,
  });
  if (!query.success) return { ok: false, code: 'INVALID_INPUT' };
  const cursor = decodeScheduleCursor(query.data.cursor, query.data.month);
  return cursor.ok ? { ok: true, data: query.data } : cursor;
}
export function resolveAdminScheduleQuery(
  input: unknown,
  now = new Date(),
): ScheduleResult<AdminScheduleQuery> {
  const parsed = z
    .strictObject({
      month: scheduleMonthSchema.optional(),
      page: z
        .string()
        .regex(/^[1-9]\d*$/)
        .optional(),
    })
    .safeParse(input);
  if (!parsed.success || !Number.isFinite(now.getTime()))
    return { ok: false, code: 'INVALID_INPUT' };
  const query = adminScheduleQuerySchema.safeParse({
    month: parsed.data.month ?? scheduleMonthAt(now),
    page: parsed.data.page === undefined ? 1 : Number(parsed.data.page),
  });
  return query.success
    ? { ok: true, data: query.data }
    : { ok: false, code: 'INVALID_INPUT' };
}
export function encodeScheduleCursor(cursor: ScheduleCursor): string {
  return btoa(JSON.stringify(cursor))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}
export function decodeScheduleCursor(
  raw: string | null,
  month: string,
): ScheduleResult<ScheduleCursor | null> {
  if (raw === null) return { ok: true, data: null };
  if (raw.length > SCHEDULES.cursorMax || !/^[A-Za-z0-9_-]+$/.test(raw))
    return { ok: false, code: 'INVALID_INPUT' };
  try {
    const parsed = scheduleCursorSchema.safeParse(
      JSON.parse(atob(raw.replaceAll('-', '+').replaceAll('_', '/'))),
    );
    return parsed.success &&
      parsed.data.month === month &&
      encodeScheduleCursor(parsed.data) === raw
      ? { ok: true, data: parsed.data }
      : { ok: false, code: 'INVALID_INPUT' };
  } catch {
    return { ok: false, code: 'INVALID_INPUT' };
  }
}
export async function listSchedules(
  port: ScheduleReadPort,
  input: unknown,
): Promise<ScheduleResult<ScheduleList>> {
  const query = scheduleQuerySchema.safeParse(input);
  if (!query.success) return { ok: false, code: 'INVALID_INPUT' };
  const cursor = decodeScheduleCursor(query.data.cursor, query.data.month);
  if (!cursor.ok) return cursor;
  try {
    const [events, mine] = await Promise.all([
      port.list(query.data.month, cursor.data),
      port.myArtists(),
    ]);
    if (!events.ok) return events;
    if (!mine.ok) return mine;
    const last = events.data.at(-1);
    return {
      ok: true,
      data: {
        month: query.data.month,
        items: events.data,
        myArtistIds: mine.data,
        nextCursor:
          events.data.length === SCHEDULES.pageSize && last
            ? encodeScheduleCursor({
                month: query.data.month,
                starts_at: last.starts_at,
                id: last.id,
              })
            : null,
      },
    };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function getSchedule(
  port: ScheduleReadPort,
  id: unknown,
): Promise<ScheduleResult<ScheduleEvent>> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    return await port.detail(parsed.data);
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function listAdminSchedules(
  port: ScheduleReadPort,
  input: unknown,
): Promise<ScheduleResult<AdminScheduleList>> {
  const parsed = adminScheduleQuerySchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    return await port.adminList(parsed.data);
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function getAdminSchedule(
  port: ScheduleReadPort,
  id: unknown,
): Promise<ScheduleResult<AdminSchedule>> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    return await port.adminDetail(parsed.data);
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
