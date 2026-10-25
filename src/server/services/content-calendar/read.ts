import 'server-only';
import { z } from 'zod';
import { scheduleMonthAt } from '@/lib/schedule-view';
import {
  contentCalendarMonthSchema,
  artistContentCalendarQuerySchema,
  adminContentCalendarQuerySchema,
  artistContentCalendarSchema,
  adminContentCalendarSchema,
  type ArtistContentCalendar,
  type AdminContentCalendar,
  type ArtistContentCalendarQuery,
  type AdminContentCalendarQuery,
  type ContentCalendarResult,
} from '@/config/content-calendar';

export type ContentCalendarReadPort = {
  artist(
    query: ArtistContentCalendarQuery,
  ): Promise<ContentCalendarResult<ArtistContentCalendar>>;
  admin(
    query: AdminContentCalendarQuery,
  ): Promise<ContentCalendarResult<AdminContentCalendar>>;
};
export function resolveContentCalendarMonth(
  input: unknown,
  now = new Date(),
): ContentCalendarResult<string> {
  const parsed = z
    .strictObject({ month: contentCalendarMonthSchema.optional() })
    .safeParse(input);
  if (!parsed.success || !Number.isFinite(now.getTime()))
    return { ok: false, code: 'INVALID_INPUT' };
  const month = contentCalendarMonthSchema.safeParse(
    parsed.data.month ?? scheduleMonthAt(now),
  );
  return month.success
    ? { ok: true, data: month.data }
    : { ok: false, code: 'INVALID_INPUT' };
}
export async function readArtistContentCalendar(
  port: ContentCalendarReadPort,
  input: unknown,
): Promise<ContentCalendarResult<ArtistContentCalendar>> {
  const parsed = artistContentCalendarQuerySchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.artist(parsed.data);
    if (!result.ok) return result;
    const page = artistContentCalendarSchema.safeParse(result.data);
    return page.success &&
      page.data.artist.slug === parsed.data.slug &&
      page.data.month === parsed.data.month
      ? { ok: true, data: page.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function readAdminContentCalendar(
  port: ContentCalendarReadPort,
  input: unknown,
): Promise<ContentCalendarResult<AdminContentCalendar>> {
  const parsed = adminContentCalendarQuerySchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.admin(parsed.data);
    if (!result.ok) return result;
    const page = adminContentCalendarSchema.safeParse(result.data);
    return page.success &&
      page.data.artist.id === parsed.data.artist_id &&
      page.data.month === parsed.data.month
      ? { ok: true, data: page.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
