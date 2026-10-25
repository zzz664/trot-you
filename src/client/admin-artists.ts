import { z } from 'zod';
import {
  ADMIN_ARTISTS,
  ADMIN_ARTIST_HTTP_OK,
  ADMIN_ARTIST_ERROR_STATUS,
  adminArtistListSchema,
  adminArtistDetailSchema,
  artistAccountInvitationsSchema,
  adminArtistSchema,
  artistInvitationSchema,
  adminArtistSaveSchema,
  adminArtistPreviewsSchema,
  adminArtistInviteSchema,
  adminArtistCancelInviteSchema,
  adminArtistUnlinkSchema,
  artistAccountRespondSchema,
  type AdminArtistError,
  type AdminArtistResult,
  type AdminArtistSaveInput,
  type AdminArtistPreviewsInput,
  type AdminArtistInviteInput,
  type AdminArtistCancelInviteInput,
  type AdminArtistUnlinkInput,
  type ArtistAccountRespondInput,
} from '@/config/admin-artists';
import { adminArtistApiPath, routes } from '@/config/routes';

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  signal?: AbortSignal,
): Promise<AdminArtistResult<T>> {
  if (signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
  try {
    const timeout = AbortSignal.timeout(ADMIN_ARTISTS.requestTimeoutMs);
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
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
        if (bytes > ADMIN_ARTISTS.responseMaxBytes) {
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
      return response.status === ADMIN_ARTIST_HTTP_OK
        ? parsed.data
        : { ok: false, code: 'UNAVAILABLE' };
    if (Object.hasOwn(ADMIN_ARTIST_ERROR_STATUS, parsed.data.code)) {
      const code = parsed.data.code as AdminArtistError;
      if (response.status === ADMIN_ARTIST_ERROR_STATUS[code])
        return { ok: false, code };
    }
  } catch {
    // Financial previews, identifiers and session data are never logged.
  }
  return { ok: false, code: 'UNAVAILABLE' };
}

export function fetchAdminArtists(page: number, signal?: AbortSignal) {
  if (!Number.isInteger(page) || page < 1 || page > ADMIN_ARTISTS.maxPage)
    return Promise.resolve({
      ok: false as const,
      code: 'INVALID_INPUT' as const,
    });
  return request(
    `${routes.adminArtistsApi}?${new URLSearchParams({ page: String(page) })}`,
    adminArtistListSchema,
    undefined,
    signal,
  );
}
export function fetchAdminArtist(id: string, signal?: AbortSignal, page = 1) {
  if (
    !z.uuid().safeParse(id).success ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > ADMIN_ARTISTS.maxPage
  )
    return Promise.resolve({
      ok: false as const,
      code: 'INVALID_INPUT' as const,
    });
  return request(
    `${routes.adminArtistsApi}?${new URLSearchParams({ id, ...(page > 1 ? { page: String(page) } : {}) })}`,
    adminArtistDetailSchema,
    undefined,
    signal,
  );
}
export function fetchArtistAccess(signal?: AbortSignal, page = 1) {
  if (!Number.isInteger(page) || page < 1 || page > ADMIN_ARTISTS.maxPage)
    return Promise.resolve({
      ok: false as const,
      code: 'INVALID_INPUT' as const,
    });
  return request(
    page > 1
      ? `${routes.artistAccessApi}?${new URLSearchParams({ page: String(page) })}`
      : routes.artistAccessApi,
    artistAccountInvitationsSchema,
    undefined,
    signal,
  );
}
function mutation<T, R>(
  path: string,
  schema: z.ZodType<T>,
  responseSchema: z.ZodType<R>,
  input: T,
  signal?: AbortSignal,
) {
  const parsed = schema.safeParse(input);
  return parsed.success
    ? request(path, responseSchema, parsed.data, signal)
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export const saveAdminArtist = (
  input: AdminArtistSaveInput,
  signal?: AbortSignal,
) =>
  mutation(
    adminArtistApiPath('save'),
    adminArtistSaveSchema,
    adminArtistSchema,
    input,
    signal,
  );
export const saveAdminPreviews = (
  input: AdminArtistPreviewsInput,
  signal?: AbortSignal,
) =>
  mutation(
    adminArtistApiPath('previews'),
    adminArtistPreviewsSchema,
    adminArtistSchema,
    input,
    signal,
  );
export const inviteArtistAccount = (
  input: AdminArtistInviteInput,
  signal?: AbortSignal,
) =>
  mutation(
    adminArtistApiPath('invite'),
    adminArtistInviteSchema,
    artistInvitationSchema,
    input,
    signal,
  );
export const cancelArtistInvitation = (
  input: AdminArtistCancelInviteInput,
  signal?: AbortSignal,
) =>
  mutation(
    adminArtistApiPath('cancel-invite'),
    adminArtistCancelInviteSchema,
    artistInvitationSchema,
    input,
    signal,
  );
export const unlinkArtistAccount = (
  input: AdminArtistUnlinkInput,
  signal?: AbortSignal,
) =>
  mutation(
    adminArtistApiPath('unlink'),
    adminArtistUnlinkSchema,
    adminArtistSchema,
    input,
    signal,
  );
export const respondArtistInvitation = (
  input: ArtistAccountRespondInput,
  signal?: AbortSignal,
) =>
  mutation(
    routes.artistAccessApi,
    artistAccountRespondSchema,
    artistInvitationSchema,
    input,
    signal,
  );
