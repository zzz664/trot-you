import 'server-only';
import { z } from 'zod';
import {
  COMMUNITY_POSTS,
  type CommunityResult,
} from '@/config/community-posts';
import {
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
  type ModerationContext,
  type ModerationCursor,
  type ModerationQueue,
  type ModerationNotices,
  type ModerationReportInput,
  type ModerationReportReceipt,
  type ModerationResolveInput,
  type ModerationResolveReceipt,
  type ModerationRestrictInput,
  type ModerationRestrictReceipt,
} from '@/config/community-moderation';
export type CommunityModerationPort = {
  context(
    target: ModerationTarget,
  ): Promise<CommunityResult<ModerationContext>>;
  queue(
    cursor: ModerationCursor | null,
  ): Promise<CommunityResult<ModerationQueue>>;
  notices(
    cursor: ModerationCursor | null,
  ): Promise<CommunityResult<ModerationNotices>>;
  report(
    input: ModerationReportInput,
  ): Promise<CommunityResult<ModerationReportReceipt>>;
  resolve(
    input: ModerationResolveInput,
  ): Promise<CommunityResult<ModerationResolveReceipt>>;
  restrict(
    input: ModerationRestrictInput,
  ): Promise<CommunityResult<ModerationRestrictReceipt>>;
};
export function resolveModerationCursor(
  input: unknown,
): CommunityResult<ModerationCursor | null> {
  const raw = z
    .strictObject({
      cursor: z.string().min(1).max(COMMUNITY_POSTS.cursorMax).optional(),
    })
    .safeParse(input);
  if (!raw.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const value: unknown =
      raw.data.cursor === undefined ? null : JSON.parse(raw.data.cursor);
    const parsed = moderationCursorSchema.nullable().safeParse(value);
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, code: 'INVALID_INPUT' };
  } catch {
    return { ok: false, code: 'INVALID_INPUT' };
  }
}
async function validated<I, O>(
  input: unknown,
  inputSchema: z.ZodType<I>,
  outputSchema: z.ZodType<O>,
  action: (input: I) => Promise<CommunityResult<O>>,
  matches: (input: I, output: O) => boolean,
): Promise<CommunityResult<O>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await action(parsed.data);
    if (!result.ok) return result;
    const output = outputSchema.safeParse(result.data);
    return output.success && matches(parsed.data, output.data)
      ? { ok: true, data: output.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export function getModerationContext(
  port: CommunityModerationPort,
  input: unknown,
  actorId: string,
) {
  if (!z.uuid().safeParse(actorId).success)
    return Promise.resolve({
      ok: false as const,
      code: 'INVALID_INPUT' as const,
    });
  return validated(
    input,
    moderationTargetSchema,
    moderationContextSchema,
    (target) => port.context(target),
    (target, context) =>
      context.actor_id === actorId &&
      context.target_type === target.target_type &&
      context.target_id === target.target_id,
  );
}
export function listModerationQueue(
  port: CommunityModerationPort,
  cursor: unknown,
  actorId: string,
) {
  if (!z.uuid().safeParse(actorId).success)
    return Promise.resolve({
      ok: false as const,
      code: 'INVALID_INPUT' as const,
    });
  return validated(
    cursor,
    moderationCursorSchema.nullable(),
    moderationQueueSchema,
    (value) => port.queue(value),
    (value, page) =>
      page.actor_id === actorId &&
      (value === null ||
        page.reports.every((report) => moderationBefore(report, value))),
  );
}
export function listModerationNotices(
  port: CommunityModerationPort,
  cursor: unknown,
  actorId: string,
) {
  if (!z.uuid().safeParse(actorId).success)
    return Promise.resolve({
      ok: false as const,
      code: 'INVALID_INPUT' as const,
    });
  return validated(
    cursor,
    moderationCursorSchema.nullable(),
    moderationNoticesSchema,
    (value) => port.notices(value),
    (value, page) =>
      page.actor_id === actorId &&
      (value === null ||
        page.notices.every((notice) => moderationBefore(notice, value))),
  );
}
export function reportCommunityTarget(
  port: CommunityModerationPort,
  input: unknown,
) {
  return validated(
    input,
    moderationReportInputSchema,
    moderationReportReceiptSchema,
    (value) => port.report(value),
    (value, receipt) =>
      value.target_id === receipt.target_id &&
      value.target_type === receipt.target_type,
  );
}
export function resolveModerationReport(
  port: CommunityModerationPort,
  input: unknown,
) {
  return validated(
    input,
    moderationResolveInputSchema,
    moderationResolveReceiptSchema,
    (value) => port.resolve(value),
    (value, receipt) =>
      value.report_id === receipt.report_id &&
      value.decision === receipt.decision &&
      (receipt.revision === value.expected_revision ||
        receipt.revision === value.expected_revision + 1),
  );
}
export function restrictModerationUser(
  port: CommunityModerationPort,
  input: unknown,
) {
  return validated(
    input,
    moderationRestrictInputSchema,
    moderationRestrictReceiptSchema,
    (value) => port.restrict(value),
    (value, receipt) =>
      value.user_id === receipt.user_id &&
      value.restricted === receipt.is_restricted &&
      (value.until === null
        ? receipt.restricted_until === null
        : receipt.restricted_until !== null &&
          moderationSameInstant(value.until, receipt.restricted_until)),
  );
}
