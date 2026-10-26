import { z } from 'zod';
import {
  COMMUNITY_POSTS,
  COMMUNITY_ERROR_STATUS,
  type CommunityResult,
  type CommunityError,
} from '@/config/community-posts';
import {
  COMMUNITY_INTERACTIONS,
  communityInteractionsQuerySchema,
  communityInteractionsSchema,
  communityCommentAfter,
  communityCommentCreateSchema,
  communityCommentUpdateSchema,
  communityCommentDeleteSchema,
  communityLikeSchema,
  communityCommentReceiptSchema,
  communityCommentDeletedSchema,
  communityLikeReceiptSchema,
  type CommunityInteractionsQuery,
  type CommunityCommentCreateInput,
  type CommunityCommentUpdateInput,
  type CommunityCommentDeleteInput,
  type CommunityLikeInput,
} from '@/config/community-interactions';
import { artistSlugSchema } from '@/config/artists';
import {
  communityCommentsPath,
  communityCommentActionPath,
  communityLikePath,
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
        if (bytes > COMMUNITY_INTERACTIONS.responseMaxBytes) {
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

export function fetchCommunityInteractions(
  query: CommunityInteractionsQuery,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = communityInteractionsQuerySchema.safeParse(query);
  return parsed.success
    ? bound(
        request(
          communityCommentsPath(
            parsed.data.slug,
            parsed.data.post_id,
            parsed.data.cursor ? JSON.stringify(parsed.data.cursor) : null,
          ),
          communityInteractionsSchema,
          undefined,
          signal,
          actorKey,
        ),
        (data) =>
          data.actor_id === actorKey &&
          data.post_id === parsed.data.post_id &&
          (!parsed.data.cursor ||
            data.comments.every((comment) =>
              communityCommentAfter(comment, parsed.data.cursor!),
            )),
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function createCommunityComment(
  slug: string,
  input: CommunityCommentCreateInput,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = communityCommentCreateSchema.safeParse(input);
  return parsed.success && artistSlugSchema.safeParse(slug).success
    ? bound(
        request(
          communityCommentsPath(slug, parsed.data.post_id),
          communityCommentReceiptSchema,
          parsed.data,
          signal,
          actorKey,
        ),
        (data) =>
          data.id === parsed.data.comment_id &&
          data.post_id === parsed.data.post_id &&
          data.revision === 1,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function updateCommunityComment(
  slug: string,
  input: CommunityCommentUpdateInput,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = communityCommentUpdateSchema.safeParse(input);
  return parsed.success && artistSlugSchema.safeParse(slug).success
    ? bound(
        request(
          communityCommentActionPath(
            slug,
            parsed.data.post_id,
            parsed.data.comment_id,
            'edit',
          ),
          communityCommentReceiptSchema,
          parsed.data,
          signal,
          actorKey,
        ),
        (data) =>
          data.id === parsed.data.comment_id &&
          data.post_id === parsed.data.post_id &&
          (data.revision === parsed.data.expected_revision ||
            data.revision === parsed.data.expected_revision + 1),
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function deleteCommunityComment(
  slug: string,
  input: CommunityCommentDeleteInput,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = communityCommentDeleteSchema.safeParse(input);
  return parsed.success && artistSlugSchema.safeParse(slug).success
    ? bound(
        request(
          communityCommentActionPath(
            slug,
            parsed.data.post_id,
            parsed.data.comment_id,
            'delete',
          ),
          communityCommentDeletedSchema,
          parsed.data,
          signal,
          actorKey,
        ),
        (data) =>
          data.id === parsed.data.comment_id &&
          data.post_id === parsed.data.post_id,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function setCommunityLike(
  slug: string,
  input: CommunityLikeInput,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = communityLikeSchema.safeParse(input);
  return parsed.success && artistSlugSchema.safeParse(slug).success
    ? bound(
        request(
          communityLikePath(slug, parsed.data.post_id),
          communityLikeReceiptSchema,
          parsed.data,
          signal,
          actorKey,
        ),
        (data) =>
          data.post_id === parsed.data.post_id &&
          data.liked === parsed.data.liked,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
