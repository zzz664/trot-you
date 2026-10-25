import { z } from 'zod';
import { ADMIN_ARTISTS, adminArtistListSchema } from '@/config/admin-artists';
import {
  CONTENT_CALENDAR,
  CONTENT_CALENDAR_ERROR_STATUS,
  artistContentCalendarSchema,
  adminContentCalendarSchema,
  adminContentCalendarQuerySchema,
  artistContentCalendarQuerySchema,
  contentCalendarSaveSchema,
  contentCalendarDeleteSchema,
  contentCalendarEntrySchema,
  contentCalendarDeletedSchema,
  type ContentCalendarResult,
  type ContentCalendarError,
  type AdminContentCalendarQuery,
  type ArtistContentCalendarQuery,
  type ContentCalendarSaveInput,
  type ContentCalendarDeleteInput,
} from '@/config/content-calendar';
import {
  routes,
  adminContentCalendarPath,
  adminContentCalendarApiPath,
  artistContentCalendarPath,
} from '@/config/routes';
async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  signal?: AbortSignal,
  actorKey?: string,
): Promise<ContentCalendarResult<T>> {
  if (actorKey !== undefined && !z.uuid().safeParse(actorKey).success)
    return { ok: false, code: 'FORBIDDEN' };
  if (signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
  try {
    const timeout = AbortSignal.timeout(CONTENT_CALENDAR.requestTimeoutMs);
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(actorKey ? { [CONTENT_CALENDAR.actorHeader]: actorKey } : {}),
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
        if (bytes > CONTENT_CALENDAR.responseMaxBytes) {
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
      return response.status === CONTENT_CALENDAR.httpOk
        ? parsed.data
        : { ok: false, code: 'UNAVAILABLE' };
    if (Object.hasOwn(CONTENT_CALENDAR_ERROR_STATUS, parsed.data.code)) {
      const code = parsed.data.code as ContentCalendarError;
      if (response.status === CONTENT_CALENDAR_ERROR_STATUS[code])
        return { ok: false, code };
    }
  } catch {
    // Settings values, identifiers and session data are never logged.
  }
  return { ok: false, code: 'UNAVAILABLE' };
}

async function bound<T>(
  result: Promise<ContentCalendarResult<T>>,
  matches: (data: T) => boolean,
): Promise<ContentCalendarResult<T>> {
  const value = await result;
  return value.ok && !matches(value.data)
    ? { ok: false, code: 'UNAVAILABLE' }
    : value;
}

export function fetchAdminContentCalendar(
  query: AdminContentCalendarQuery,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = adminContentCalendarQuerySchema.safeParse(query);
  return parsed.success
    ? bound(
        request(
          adminContentCalendarPath(
            parsed.data.month,
            parsed.data.artist_id,
            1,
            true,
          ),
          adminContentCalendarSchema,
          undefined,
          signal,
          actorKey,
        ),
        (data) =>
          data.month === parsed.data.month &&
          data.artist.id === parsed.data.artist_id,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function fetchArtistContentCalendar(
  query: ArtistContentCalendarQuery,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = artistContentCalendarQuerySchema.safeParse(query);
  return parsed.success
    ? bound(
        request(
          artistContentCalendarPath(parsed.data.slug, parsed.data.month, true),
          artistContentCalendarSchema,
          undefined,
          signal,
          actorKey,
        ),
        (data) =>
          data.month === parsed.data.month &&
          data.artist.slug === parsed.data.slug,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function saveContentCalendar(
  input: ContentCalendarSaveInput,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = contentCalendarSaveSchema.safeParse(input);
  return parsed.success
    ? bound(
        request(
          adminContentCalendarApiPath('save'),
          contentCalendarEntrySchema,
          parsed.data,
          signal,
          actorKey,
        ),
        (data) =>
          (parsed.data.entry_id === null || data.id === parsed.data.entry_id) &&
          data.artist_id === parsed.data.input.artist_id &&
          data.date === parsed.data.input.date &&
          data.topic === parsed.data.input.topic &&
          data.example_text === parsed.data.input.example_text &&
          (parsed.data.expected_revision === null
            ? data.revision === 1
            : data.revision === parsed.data.expected_revision ||
              data.revision === parsed.data.expected_revision + 1),
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function deleteContentCalendar(
  input: ContentCalendarDeleteInput,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = contentCalendarDeleteSchema.safeParse(input);
  return parsed.success
    ? bound(
        request(
          adminContentCalendarApiPath('delete'),
          contentCalendarDeletedSchema,
          parsed.data,
          signal,
          actorKey,
        ),
        (data) => data.id === parsed.data.entry_id,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function fetchContentCalendarArtists(
  page: number,
  signal?: AbortSignal,
  actorKey?: string,
) {
  return Number.isSafeInteger(page) &&
    page >= 1 &&
    page <= ADMIN_ARTISTS.maxPage
    ? request(
        `${routes.adminContentCalendarApi}?${new URLSearchParams({ artists: '1', page: String(page) })}`,
        adminArtistListSchema,
        undefined,
        signal,
        actorKey,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
