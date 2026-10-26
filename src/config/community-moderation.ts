import { z } from 'zod';
import { communityArtistSchema, COMMUNITY_POSTS } from './community-posts';

// Transport ceilings, not approved operating defaults. Policy is read from DB.
export const COMMUNITY_MODERATION = {
  pageSize: 20,
  timeZone: 'Asia/Seoul',
  reasonMax: 10000,
  bodyMax: COMMUNITY_POSTS.bodyMax,
  responseMaxBytes: 16 * 1024 * 1024,
  dialogKey: 'community-moderation-confirm',
} as const;
const instant = z.iso
  .datetime({ offset: true })
  .refine(
    (value) =>
      !value.startsWith('0000-') &&
      (value.match(/\.(\d+)/)?.[1]?.length ?? 0) <= 6,
  );
const revision = z.number().int().positive().safe();
const reason = z
  .string()
  .refine(
    (value) =>
      value.trim().length > 0 &&
      Array.from(value).length <= COMMUNITY_MODERATION.reasonMax &&
      !/[\p{Cc}\p{Cs}]/u.test(value.replace(/[\n\r\t]/g, '')),
  );
export const moderationTargetSchema = z.strictObject({
  target_type: z.enum(['post', 'comment', 'reply']),
  target_id: z.uuid(),
});
export type ModerationTarget = z.output<typeof moderationTargetSchema>;
export const moderationStatusSchema = z.enum([
  'open',
  'hidden',
  'restored',
  'deleted',
]);
export const moderationCursorSchema = z.strictObject({
  created_at: instant,
  id: z.uuid(),
});
export type ModerationCursor = z.output<typeof moderationCursorSchema>;
function micros(value: string) {
  const fraction = value.match(/\.(\d+)/)?.[1] ?? '';
  return (
    BigInt(Date.parse(value)) * 1000n +
    BigInt(fraction.padEnd(6, '0').slice(3, 6))
  );
}
export function moderationSameInstant(value: string, other: string) {
  return micros(value) === micros(other);
}
export function moderationBefore(
  value: ModerationCursor,
  before: ModerationCursor,
) {
  const difference = micros(value.created_at) - micros(before.created_at);
  return difference < 0n || (difference === 0n && value.id < before.id);
}
export const moderationContextSchema = z.strictObject({
  actor_id: z.uuid(),
  ...moderationTargetSchema.shape,
  max_reason_length: z
    .number()
    .int()
    .positive()
    .max(COMMUNITY_MODERATION.reasonMax),
  existing_report: z
    .strictObject({ id: z.uuid(), status: moderationStatusSchema })
    .nullable(),
});
export type ModerationContext = z.output<typeof moderationContextSchema>;
export const moderationReportInputSchema = z.strictObject({
  operation_id: z.uuid(),
  ...moderationTargetSchema.shape,
  reason,
});
export type ModerationReportInput = z.output<
  typeof moderationReportInputSchema
>;
export const moderationReportReceiptSchema = z.strictObject({
  id: z.uuid(),
  ...moderationTargetSchema.shape,
});
export type ModerationReportReceipt = z.output<
  typeof moderationReportReceiptSchema
>;
export const moderationReportSchema = z
  .strictObject({
    id: z.uuid(),
    ...moderationTargetSchema.shape,
    reason,
    status: moderationStatusSchema,
    created_at: instant,
    resolved_at: instant.nullable(),
    target: z.strictObject({
      artist: communityArtistSchema,
      post_id: z.uuid().nullable(),
      title: z
        .string()
        .refine((value) => Array.from(value).length <= COMMUNITY_POSTS.titleMax)
        .nullable(),
      body: z
        .string()
        .refine((v) => Array.from(v).length <= COMMUNITY_MODERATION.bodyMax),
      is_hidden: z.boolean(),
      deleted_at: instant.nullable(),
      revision,
      report_count: z.number().int().nonnegative().safe(),
      owner: z
        .strictObject({
          id: z.uuid(),
          call_name: z.string().min(1).nullable(),
          is_restricted: z.boolean(),
          restricted_until: instant.nullable(),
          updated_at: instant,
          can_restrict: z.boolean(),
        })
        .refine(
          (owner) => owner.is_restricted || owner.restricted_until === null,
        ),
    }),
  })
  .refine(
    (report) =>
      (report.target_type === 'reply'
        ? report.target.post_id === null
        : report.target.post_id !== null) &&
      (report.target_type === 'post'
        ? report.target.post_id === report.target_id &&
          report.target.title !== null
        : report.target.title === null) &&
      (report.status === 'open' || report.status === 'hidden'
        ? report.resolved_at === null
        : report.resolved_at !== null),
  );
export type ModerationReport = z.output<typeof moderationReportSchema>;
function ordered(items: ModerationCursor[], cursor: ModerationCursor | null) {
  const ids = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (
      ids.has(item.id) ||
      (index > 0 && !moderationBefore(item, items[index - 1]!))
    )
      return false;
    ids.add(item.id);
  }
  const last = items.at(-1);
  return (
    cursor === null ||
    (items.length === COMMUNITY_MODERATION.pageSize &&
      last !== undefined &&
      last.id === cursor.id &&
      last.created_at === cursor.created_at)
  );
}
export const moderationQueueSchema = z
  .strictObject({
    actor_id: z.uuid(),
    reports: z.array(moderationReportSchema).max(COMMUNITY_MODERATION.pageSize),
    next_cursor: moderationCursorSchema.nullable(),
  })
  .refine((page) => ordered(page.reports, page.next_cursor));
export type ModerationQueue = z.output<typeof moderationQueueSchema>;
export const moderationResolveInputSchema = z.strictObject({
  operation_id: z.uuid(),
  report_id: z.uuid(),
  expected_revision: revision.max(COMMUNITY_POSTS.maxMutableRevision),
  decision: z.enum(['restore', 'delete']),
  reason,
  confirmed: z.literal(true),
});
export type ModerationResolveInput = z.output<
  typeof moderationResolveInputSchema
>;
export const moderationResolveReceiptSchema = z.strictObject({
  report_id: z.uuid(),
  ...moderationTargetSchema.shape,
  decision: z.enum(['restore', 'delete']),
  revision,
});
export type ModerationResolveReceipt = z.output<
  typeof moderationResolveReceiptSchema
>;
export const moderationRestrictInputSchema = z
  .strictObject({
    operation_id: z.uuid(),
    user_id: z.uuid(),
    expected_updated_at: instant,
    restricted: z.boolean(),
    until: instant.nullable(),
    reason,
    confirmed: z.literal(true),
  })
  .refine((input) =>
    input.restricted ? input.until !== null : input.until === null,
  );
export type ModerationRestrictInput = z.output<
  typeof moderationRestrictInputSchema
>;
export const moderationRestrictReceiptSchema = z
  .strictObject({
    user_id: z.uuid(),
    is_restricted: z.boolean(),
    restricted_until: instant.nullable(),
    updated_at: instant,
  })
  .refine((input) =>
    input.is_restricted
      ? input.restricted_until !== null
      : input.restricted_until === null,
  );
export type ModerationRestrictReceipt = z.output<
  typeof moderationRestrictReceiptSchema
>;
export const moderationNoticeSchema = z.strictObject({
  id: z.uuid(),
  report_id: z.uuid(),
  decision: z.enum(['restored', 'deleted']),
  created_at: instant,
});
export type ModerationNotice = z.output<typeof moderationNoticeSchema>;
export const moderationNoticesSchema = z
  .strictObject({
    actor_id: z.uuid(),
    notices: z.array(moderationNoticeSchema).max(COMMUNITY_MODERATION.pageSize),
    next_cursor: moderationCursorSchema.nullable(),
  })
  .refine((page) => ordered(page.notices, page.next_cursor));
export type ModerationNotices = z.output<typeof moderationNoticesSchema>;
