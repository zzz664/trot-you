import { z } from 'zod';
import {
  COMMUNITY_POSTS,
  COMMUNITY_ERROR_STATUS,
  type CommunityResult,
  type CommunityError,
} from '@/config/community-posts';
import {
  COMMUNITY_MODERATION,
  moderationTargetSchema,
  moderationContextSchema,
  moderationCursorSchema,
  moderationBefore,
  moderationSameInstant,
  moderationQueueSchema,
  moderationNoticesSchema,
  moderationReportInputSchema,
  moderationReportReceiptSchema,
  moderationResolveInputSchema,
  moderationResolveReceiptSchema,
  moderationRestrictInputSchema,
  moderationRestrictReceiptSchema,
  type ModerationTarget,
  type ModerationCursor,
  type ModerationReportInput,
  type ModerationResolveInput,
  type ModerationRestrictInput,
} from '@/config/community-moderation';
import {
  moderationContextPath,
  moderationReportPath,
  moderationQueuePath,
  moderationNoticesPath,
  moderationAdminActionPath,
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
        if (bytes > COMMUNITY_MODERATION.responseMaxBytes) {
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

export function fetchModerationContext(
  target: ModerationTarget,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = moderationTargetSchema.safeParse(target);
  return parsed.success
    ? bound(
        request(
          moderationContextPath(parsed.data),
          moderationContextSchema,
          undefined,
          signal,
          actorKey,
        ),
        (context) =>
          context.actor_id === actorKey &&
          context.target_type === parsed.data.target_type &&
          context.target_id === parsed.data.target_id,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function fetchModerationQueue(
  cursor: ModerationCursor | null,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = moderationCursorSchema.nullable().safeParse(cursor);
  return parsed.success
    ? bound(
        request(
          moderationQueuePath(parsed.data ? JSON.stringify(parsed.data) : null),
          moderationQueueSchema,
          undefined,
          signal,
          actorKey,
        ),
        (page) =>
          page.actor_id === actorKey &&
          (parsed.data === null ||
            page.reports.every((report) =>
              moderationBefore(report, parsed.data!),
            )),
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function fetchModerationNotices(
  cursor: ModerationCursor | null,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = moderationCursorSchema.nullable().safeParse(cursor);
  return parsed.success
    ? bound(
        request(
          moderationNoticesPath(
            parsed.data ? JSON.stringify(parsed.data) : null,
          ),
          moderationNoticesSchema,
          undefined,
          signal,
          actorKey,
        ),
        (page) =>
          page.actor_id === actorKey &&
          (parsed.data === null ||
            page.notices.every((notice) =>
              moderationBefore(notice, parsed.data!),
            )),
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function reportCommunityTarget(
  input: ModerationReportInput,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = moderationReportInputSchema.safeParse(input);
  return parsed.success
    ? bound(
        request(
          moderationReportPath(),
          moderationReportReceiptSchema,
          parsed.data,
          signal,
          actorKey,
        ),
        (receipt) =>
          receipt.target_type === parsed.data.target_type &&
          receipt.target_id === parsed.data.target_id,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function resolveModerationReport(
  input: ModerationResolveInput,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = moderationResolveInputSchema.safeParse(input);
  return parsed.success
    ? bound(
        request(
          moderationAdminActionPath('resolve'),
          moderationResolveReceiptSchema,
          parsed.data,
          signal,
          actorKey,
        ),
        (receipt) =>
          receipt.report_id === parsed.data.report_id &&
          receipt.decision === parsed.data.decision &&
          (receipt.revision === parsed.data.expected_revision ||
            receipt.revision === parsed.data.expected_revision + 1),
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
export function restrictModerationUser(
  input: ModerationRestrictInput,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = moderationRestrictInputSchema.safeParse(input);
  return parsed.success
    ? bound(
        request(
          moderationAdminActionPath('restrict'),
          moderationRestrictReceiptSchema,
          parsed.data,
          signal,
          actorKey,
        ),
        (receipt) =>
          receipt.user_id === parsed.data.user_id &&
          receipt.is_restricted === parsed.data.restricted &&
          (parsed.data.until === null
            ? receipt.restricted_until === null
            : receipt.restricted_until !== null &&
              moderationSameInstant(
                parsed.data.until,
                receipt.restricted_until,
              )),
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
