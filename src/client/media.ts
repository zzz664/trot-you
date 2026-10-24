import { z } from 'zod';
import { getPublicEnv } from '@/config/env';
import {
  MEDIA_ERROR_STATUS,
  MEDIA_MAX_BYTES,
  MEDIA_MILLISECONDS_PER_SECOND,
  MEDIA_READ_TTL_SECONDS,
  MEDIA_REQUEST_TIMEOUT_MS,
  MEDIA_RESPONSE_MAX_BYTES,
  mediaBeginSchema,
  mediaCompleteSchema,
  mediaReadSchema,
  mediaMimeSchema,
  mediaRevokeSchema,
  type MediaBeginInput,
  type MediaError,
  type MediaReadGrant,
  type MediaMime,
  type MediaResult,
  type MediaUploadGrant,
} from '@/config/media';
import {
  MEDIA_CLIENT_UPLOAD_LIFETIME_MS,
  MEDIA_CLIENT_UPLOAD_TIMEOUT_MS,
  mediaCompletionSchema,
  mediaReadGrantSchema,
  mediaUploadGrantSchema,
} from '@/config/media-client';
import {
  STORAGE_READ_URL_PREFIX,
  STORAGE_OBJECT_PATH_PATTERN,
  STORAGE_MIME_EXTENSIONS,
  STORAGE_UPLOAD_URL_PREFIX,
} from '@/config/storage';
import { routes } from '@/config/routes';

function requestSignal(signal?: AbortSignal, upload = false) {
  const timeout = AbortSignal.timeout(
    upload ? MEDIA_CLIENT_UPLOAD_TIMEOUT_MS : MEDIA_REQUEST_TIMEOUT_MS,
  );
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function mediaRequest<T>(
  path: string,
  input: unknown,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<MediaResult<T>> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      body: JSON.stringify(input),
      signal: requestSignal(signal),
    });
    if (
      response.headers.get('content-type')?.split(';')[0]?.trim() !==
      'application/json'
    )
      return { ok: false, code: 'UNAVAILABLE' };
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, code: 'UNAVAILABLE' };
    let text = '';
    let size = 0;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MEDIA_RESPONSE_MAX_BYTES) {
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
      return response.ok ? parsed.data : { ok: false, code: 'UNAVAILABLE' };
    if (Object.hasOwn(MEDIA_ERROR_STATUS, parsed.data.code))
      return { ok: false, code: parsed.data.code as MediaError };
  } catch {
    // Never log bearer URLs, raw provider errors or uploaded bytes. Aborted or
    // lost write responses are uncertain: the caller must not auto-replay them.
  }
  return { ok: false, code: 'UNAVAILABLE' };
}

function validStorageUrl(value: string, prefix: string, resourceId: string) {
  try {
    const configured = getPublicEnv().NEXT_PUBLIC_SUPABASE_URL;
    if (!configured) return false;
    const url = new URL(value);
    const suffix = url.pathname.slice(prefix.length);
    const filename = suffix.split('/').at(-1);
    return (
      url.origin === new URL(configured).origin &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.pathname.startsWith(prefix) &&
      STORAGE_OBJECT_PATH_PATTERN.test(suffix) &&
      filename?.split('.')[0] === resourceId &&
      url.searchParams.size === 1 &&
      !!url.searchParams.get('token')
    );
  } catch {
    return false;
  }
}

function matchesMimeExtension(value: string, mime: MediaMime) {
  try {
    return new URL(value).pathname.endsWith(
      `.${STORAGE_MIME_EXTENSIONS[mime]}`,
    );
  } catch {
    return false;
  }
}

export function mediaExpiryDelay(expiresAt: string, now = Date.now()) {
  const remaining = Date.parse(expiresAt) - now;
  return Number.isFinite(remaining)
    ? Math.min(
        MEDIA_READ_TTL_SECONDS * MEDIA_MILLISECONDS_PER_SECOND,
        Math.max(0, remaining),
      )
    : 0;
}

function freshGrant(expiresAt: string, maxLifetime: number) {
  const remaining = Date.parse(expiresAt) - Date.now();
  return remaining > 0 && remaining <= maxLifetime;
}

export async function readMediaUrl(
  input: z.output<typeof mediaReadSchema>,
  signal?: AbortSignal,
): Promise<MediaResult<MediaReadGrant>> {
  const parsed = mediaReadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const result = await mediaRequest(
    routes.mediaRead,
    parsed.data,
    mediaReadGrantSchema,
    signal,
  );
  if (!result.ok) return result;
  if (
    !freshGrant(
      result.data.expiresAt,
      MEDIA_READ_TTL_SECONDS * MEDIA_MILLISECONDS_PER_SECOND,
    ) ||
    !validStorageUrl(result.data.url, STORAGE_READ_URL_PREFIX, input.mediaId) ||
    !matchesMimeExtension(result.data.url, result.data.mimeType) ||
    !result.data.mimeType.startsWith(
      result.data.kind === 'photo'
        ? 'image/'
        : result.data.kind === 'voice'
          ? 'audio/'
          : 'video/',
    )
  )
    return { ok: false, code: 'UNAVAILABLE' };
  return result;
}

export async function beginMediaUpload(
  input: MediaBeginInput,
  signal?: AbortSignal,
): Promise<MediaResult<MediaUploadGrant>> {
  const parsed = mediaBeginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const result = await mediaRequest(
    routes.mediaUpload,
    parsed.data,
    mediaUploadGrantSchema,
    signal,
  );
  if (!result.ok) return result;
  if (
    !freshGrant(result.data.expiresAt, MEDIA_CLIENT_UPLOAD_LIFETIME_MS) ||
    !validStorageUrl(
      result.data.uploadUrl,
      STORAGE_UPLOAD_URL_PREFIX,
      result.data.uploadId,
    ) ||
    !matchesMimeExtension(result.data.uploadUrl, input.mimeType)
  )
    return { ok: false, code: 'UNAVAILABLE' };
  return result;
}

// Composable steps retain the upload ID for safe status/revoke recovery. This
// helper never starts another intent, retries a PUT, or completes after a lost
// response. A successful PUT is quarantine storage, not a readable media item.
export async function uploadMediaBytes(
  grant: MediaUploadGrant,
  file: Blob,
  signal?: AbortSignal,
): Promise<MediaResult<null>> {
  if (
    !mediaUploadGrantSchema.safeParse(grant).success ||
    !freshGrant(grant.expiresAt, MEDIA_CLIENT_UPLOAD_LIFETIME_MS) ||
    !validStorageUrl(grant.uploadUrl, STORAGE_UPLOAD_URL_PREFIX, grant.uploadId)
  )
    return { ok: false, code: 'INVALID_INPUT' };
  const mime = mediaMimeSchema.safeParse(file.type);
  if (!mime.success || !matchesMimeExtension(grant.uploadUrl, mime.data))
    return { ok: false, code: 'INVALID_CONTENT' };
  if (file.size <= 0 || file.size > MEDIA_MAX_BYTES)
    return { ok: false, code: 'LIMIT_EXCEEDED' };
  try {
    const response = await fetch(grant.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'Cache-Control': 'max-age=0',
        'x-upsert': 'false',
      },
      body: file,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: requestSignal(signal, true),
    });
    return response.ok
      ? { ok: true, data: null }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}

export async function completeMediaUpload(
  input: z.output<typeof mediaCompleteSchema>,
  signal?: AbortSignal,
): Promise<MediaResult<{ mediaId: string }>> {
  const parsed = mediaCompleteSchema.safeParse(input);
  return parsed.success
    ? mediaRequest(
        routes.mediaComplete,
        parsed.data,
        mediaCompletionSchema,
        signal,
      )
    : { ok: false, code: 'INVALID_INPUT' };
}

export async function revokeMediaUpload(
  input: z.output<typeof mediaRevokeSchema>,
  signal?: AbortSignal,
): Promise<MediaResult<null>> {
  const parsed = mediaRevokeSchema.safeParse(input);
  return parsed.success
    ? mediaRequest(routes.mediaRevoke, parsed.data, z.null(), signal)
    : { ok: false, code: 'INVALID_INPUT' };
}
