import { z } from 'zod';
import { getPublicEnv } from '@/config/env';
import {
  COMMUNITY_POSTS,
  COMMUNITY_ERROR_STATUS,
  type CommunityError,
  type CommunityResult,
} from '@/config/community-posts';
import {
  COMMUNITY_MEDIA,
  communityImageBeginSchema,
  communityImageUploadSchema,
  communityImageReadSchema,
  communityImageMimeSchema,
  communityImageGrantSchema,
  communityImageCompletionSchema,
  communityImageReadGrantSchema,
  type CommunityImageBegin,
  type CommunityImageGrant,
  type CommunityImageReadGrant,
} from '@/config/community-media';
import {
  STORAGE_BOARD_UPLOAD_URL_PREFIX,
  STORAGE_BOARD_READ_URL_PREFIX,
  STORAGE_BOARD_PATH_PATTERN,
  STORAGE_BOARD_MAX_BYTES,
  STORAGE_MIME_EXTENSIONS,
  STORAGE_SIGNED_TOKEN_MAX_LENGTH,
} from '@/config/storage';
import { routes } from '@/config/routes';

function requestSignal(signal?: AbortSignal, upload = false) {
  const timeout = AbortSignal.timeout(
    upload ? COMMUNITY_MEDIA.uploadTimeoutMs : COMMUNITY_MEDIA.requestTimeoutMs,
  );
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
async function request<T>(
  path: string,
  input: unknown,
  schema: z.ZodType<T>,
  signal: AbortSignal | undefined,
  actorKey: string,
): Promise<CommunityResult<T>> {
  if (!z.uuid().safeParse(actorKey).success)
    return { ok: false, code: 'FORBIDDEN' };
  try {
    const active = requestSignal(signal);
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [COMMUNITY_POSTS.actorHeader]: actorKey,
      },
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      body: JSON.stringify(input),
      signal: active,
    });
    if (
      response.headers.get('content-type')?.split(';')[0]?.trim() !==
        'application/json' ||
      response.redirected
    )
      return { ok: false, code: 'UNAVAILABLE' };
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, code: 'UNAVAILABLE' };
    const abort = () => {
      void reader.cancel().catch(() => undefined);
    };
    active.addEventListener('abort', abort, { once: true });
    let text = '';
    let size = 0;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      while (true) {
        if (active.aborted) throw new Error('ABORTED');
        const { value, done } = await reader.read();
        if (active.aborted) throw new Error('ABORTED');
        if (done) break;
        size += value.byteLength;
        if (size > COMMUNITY_MEDIA.responseMaxBytes) {
          await reader.cancel();
          return { ok: false, code: 'UNAVAILABLE' };
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      active.removeEventListener('abort', abort);
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
      return response.status === COMMUNITY_POSTS.httpOk
        ? parsed.data
        : { ok: false, code: 'UNAVAILABLE' };
    if (Object.hasOwn(COMMUNITY_ERROR_STATUS, parsed.data.code)) {
      const code = parsed.data.code as CommunityError;
      if (response.status === COMMUNITY_ERROR_STATUS[code])
        return { ok: false, code };
    }
  } catch {
    /* Lost responses are uncertain, never silently resent. */
  }
  return { ok: false, code: 'UNAVAILABLE' };
}
function storagePath(value: string, prefix: string, resourceId: string) {
  try {
    const configured = getPublicEnv().NEXT_PUBLIC_SUPABASE_URL;
    if (!configured) return null;
    const url = new URL(value);
    const suffix = url.pathname.slice(prefix.length);
    return url.origin === new URL(configured).origin &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.pathname.startsWith(prefix) &&
      STORAGE_BOARD_PATH_PATTERN.test(suffix) &&
      suffix.split('/').at(-1)?.split('.')[0] === resourceId &&
      url.searchParams.size === 1 &&
      !!url.searchParams.get('token') &&
      url.searchParams.get('token')!.length <= STORAGE_SIGNED_TOKEN_MAX_LENGTH
      ? suffix
      : null;
  } catch {
    return null;
  }
}
function fresh(expiresAt: string, maxLifetime: number) {
  const remaining = Date.parse(expiresAt) - Date.now();
  return remaining > 0 && remaining <= maxLifetime;
}
export function communityImageExpiryDelay(expiresAt: string, now = Date.now()) {
  const remaining = Date.parse(expiresAt) - now;
  return Number.isFinite(remaining)
    ? Math.min(
        COMMUNITY_MEDIA.readTtlSeconds * COMMUNITY_MEDIA.millisecondsPerSecond,
        Math.max(0, remaining),
      )
    : 0;
}
export async function beginCommunityImage(
  input: CommunityImageBegin,
  signal: AbortSignal | undefined,
  actorKey: string,
): Promise<CommunityResult<CommunityImageGrant>> {
  const parsed = communityImageBeginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const result = await request(
    routes.communityImageBegin,
    parsed.data,
    communityImageGrantSchema,
    signal,
    actorKey,
  );
  if (!result.ok) return result;
  if (
    !fresh(result.data.expiresAt, COMMUNITY_MEDIA.uploadLifetimeMs) ||
    storagePath(
      result.data.uploadUrl,
      STORAGE_BOARD_UPLOAD_URL_PREFIX,
      result.data.uploadId,
    ) !==
      `${input.artistId}/${input.postId}/${result.data.uploadId}.${STORAGE_MIME_EXTENSIONS[input.mimeType]}`
  )
    return { ok: false, code: 'UNAVAILABLE' };
  return result;
}
// No implicit PUT retry: after an uncertain upload, the UI may explicitly try
// completion with this same upload ID, or revoke it, but never publish a post.
export async function uploadCommunityImage(
  grant: CommunityImageGrant,
  file: Blob,
  signal?: AbortSignal,
): Promise<CommunityResult<null>> {
  if (
    !communityImageGrantSchema.safeParse(grant).success ||
    !fresh(grant.expiresAt, COMMUNITY_MEDIA.uploadLifetimeMs) ||
    !storagePath(
      grant.uploadUrl,
      STORAGE_BOARD_UPLOAD_URL_PREFIX,
      grant.uploadId,
    )
  )
    return { ok: false, code: 'INVALID_INPUT' };
  const mime = communityImageMimeSchema.safeParse(file.type);
  if (
    !mime.success ||
    !new URL(grant.uploadUrl).pathname.endsWith(
      `.${STORAGE_MIME_EXTENSIONS[mime.data]}`,
    )
  )
    return { ok: false, code: 'INVALID_CONTENT' };
  if (file.size <= 0 || file.size > STORAGE_BOARD_MAX_BYTES)
    return { ok: false, code: 'LIMIT_EXCEEDED' };
  try {
    const response = await fetch(grant.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mime.data,
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
export async function completeCommunityImage(
  input: { uploadId: string },
  signal: AbortSignal | undefined,
  actorKey: string,
): Promise<CommunityResult<{ imageId: string }>> {
  const parsed = communityImageUploadSchema.safeParse(input);
  return parsed.success
    ? request(
        routes.communityImageComplete,
        parsed.data,
        communityImageCompletionSchema,
        signal,
        actorKey,
      )
    : { ok: false, code: 'INVALID_INPUT' };
}
export async function revokeCommunityImage(
  input: { uploadId: string },
  signal: AbortSignal | undefined,
  actorKey: string,
): Promise<CommunityResult<null>> {
  const parsed = communityImageUploadSchema.safeParse(input);
  return parsed.success
    ? request(
        routes.communityImageRevoke,
        parsed.data,
        z.null(),
        signal,
        actorKey,
      )
    : { ok: false, code: 'INVALID_INPUT' };
}
export async function readCommunityImage(
  input: { imageId: string; postId: string },
  signal: AbortSignal | undefined,
  actorKey: string,
): Promise<CommunityResult<CommunityImageReadGrant>> {
  const parsed = communityImageReadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const result = await request(
    routes.communityImageRead,
    parsed.data,
    communityImageReadGrantSchema,
    signal,
    actorKey,
  );
  if (!result.ok) return result;
  const path = storagePath(
    result.data.url,
    STORAGE_BOARD_READ_URL_PREFIX,
    input.imageId,
  );
  if (
    !fresh(
      result.data.expiresAt,
      COMMUNITY_MEDIA.readTtlSeconds * COMMUNITY_MEDIA.millisecondsPerSecond,
    ) ||
    !path?.endsWith(
      `/${input.postId}/${input.imageId}.${STORAGE_MIME_EXTENSIONS[result.data.mimeType]}`,
    )
  )
    return { ok: false, code: 'UNAVAILABLE' };
  return result;
}
