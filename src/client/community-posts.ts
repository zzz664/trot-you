import { z } from 'zod';
import {
  COMMUNITY_POSTS,
  COMMUNITY_ERROR_STATUS,
  communityListQuerySchema,
  communityDetailQuerySchema,
  communityListSchema,
  communityDetailSchema,
  communityCreateSchema,
  communityDeleteSchema,
  communityNoticeSchema,
  communityCreatedSchema,
  communityDeletedSchema,
  communityNoticeReceiptSchema,
  communityCursorAfter,
  type CommunityResult,
  type CommunityError,
  type CommunityListQuery,
  type CommunityDetailQuery,
  type CommunityCreateInput,
  type CommunityDeleteInput,
  type CommunityNoticeInput,
} from '@/config/community-posts';
import {
  communityBoardPath,
  communityPostPath,
  communityPostActionPath,
} from '@/config/routes';
async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  signal?: AbortSignal,
  actorKey?: string,
): Promise<CommunityResult<T>> {
  if (!z.uuid().safeParse(actorKey).success)
    return { ok: false, code: 'FORBIDDEN' };
  if (signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
  try {
    const timeout = AbortSignal.timeout(COMMUNITY_POSTS.requestTimeoutMs);
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(actorKey ? { [COMMUNITY_POSTS.actorHeader]: actorKey } : {}),
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
        if (bytes > COMMUNITY_POSTS.responseMaxBytes) {
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
      return response.status === COMMUNITY_POSTS.httpOk
        ? parsed.data
        : { ok: false, code: 'UNAVAILABLE' };
    if (Object.hasOwn(COMMUNITY_ERROR_STATUS, parsed.data.code)) {
      const code = parsed.data.code as CommunityError;
      if (response.status === COMMUNITY_ERROR_STATUS[code])
        return { ok: false, code };
    }
  } catch {
    // Settings values, identifiers and session data are never logged.
  }
  return { ok: false, code: 'UNAVAILABLE' };
}

async function bound<T>(
  result: Promise<CommunityResult<T>>,
  matches: (data: T) => boolean,
): Promise<CommunityResult<T>> {
  const value = await result;
  return value.ok && !matches(value.data)
    ? { ok: false, code: 'UNAVAILABLE' }
    : value;
}

export function fetchCommunityPosts(
  query: CommunityListQuery,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = communityListQuerySchema.safeParse(query);
  return parsed.success
    ? bound(
        request(
          communityBoardPath(
            parsed.data.slug,
            parsed.data.cursor ? JSON.stringify(parsed.data.cursor) : null,
            true,
          ),
          communityListSchema,
          undefined,
          signal,
          actorKey,
        ),
        (data) =>
          data.actor_id === actorKey &&
          data.artist.slug === parsed.data.slug &&
          (!parsed.data.cursor ||
            data.posts.every((post) =>
              communityCursorAfter(post, parsed.data.cursor!),
            )),
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function fetchCommunityPost(
  query: CommunityDetailQuery,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = communityDetailQuerySchema.safeParse(query);
  return parsed.success
    ? bound(
        request(
          communityPostPath(parsed.data.slug, parsed.data.post_id, true),
          communityDetailSchema,
          undefined,
          signal,
          actorKey,
        ),
        (data) =>
          data.actor_id === actorKey &&
          data.artist.slug === parsed.data.slug &&
          data.post.id === parsed.data.post_id,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function createCommunityPost(
  slug: string,
  input: CommunityCreateInput,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = communityCreateSchema.safeParse(input);
  return parsed.success &&
    communityListQuerySchema.safeParse({ slug, cursor: null }).success
    ? bound(
        request(
          communityBoardPath(slug, null, true),
          communityCreatedSchema,
          parsed.data,
          signal,
          actorKey,
        ),
        (data) =>
          data.id === parsed.data.post_id &&
          data.artist_id === parsed.data.artist_id &&
          data.revision === 1,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function deleteCommunityPost(
  slug: string,
  input: CommunityDeleteInput,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = communityDeleteSchema.safeParse(input);
  return parsed.success &&
    communityDetailQuerySchema.safeParse({ slug, post_id: parsed.data.post_id })
      .success
    ? bound(
        request(
          communityPostActionPath(slug, parsed.data.post_id, 'delete'),
          communityDeletedSchema,
          parsed.data,
          signal,
          actorKey,
        ),
        (data) => data.id === parsed.data.post_id,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function setCommunityNotice(
  slug: string,
  input: CommunityNoticeInput,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = communityNoticeSchema.safeParse(input);
  return parsed.success &&
    communityDetailQuerySchema.safeParse({ slug, post_id: parsed.data.post_id })
      .success
    ? bound(
        request(
          communityPostActionPath(slug, parsed.data.post_id, 'notice'),
          communityNoticeReceiptSchema,
          parsed.data,
          signal,
          actorKey,
        ),
        (data) =>
          data.id === parsed.data.post_id &&
          data.is_notice === parsed.data.is_notice &&
          data.is_pinned === parsed.data.is_pinned &&
          (data.revision === parsed.data.expected_revision ||
            data.revision === parsed.data.expected_revision + 1),
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
