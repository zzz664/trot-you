import { z } from 'zod';
import { artistSlugSchema } from './artists';
import { COMMUNITY_POSTS } from './community-posts';

// Transport/schema ceilings, never an activated community operating policy.
export const COMMUNITY_INTERACTIONS = {
  pageSize: 20,
  deleteDialogKey: 'community-comment-delete',
  bodyMax: 10000,
  responseMaxBytes: 2 * 1024 * 1024,
} as const;
const instant = z.iso
  .datetime({ offset: true })
  .refine(
    (value) =>
      !value.startsWith('0000-') &&
      (value.match(/\.(\d+)/)?.[1]?.length ?? 0) <= 6,
  );
const revision = z.number().int().positive().safe();
const mutableRevision = revision.max(COMMUNITY_POSTS.maxMutableRevision);
const body = z
  .string()
  .refine(
    (value) =>
      value.trim().length > 0 &&
      Array.from(value).length <= COMMUNITY_INTERACTIONS.bodyMax &&
      !/[\p{Cc}\p{Cs}]/u.test(value.replace(/[\n\r\t]/g, '')),
  );
function timestampMicros(value: string) {
  const fraction = value.match(/\.(\d+)/)?.[1] ?? '';
  return (
    BigInt(Date.parse(value)) * 1000n +
    BigInt(fraction.padEnd(6, '0').slice(3, 6))
  );
}
export const communityCommentCursorSchema = z.strictObject({
  created_at: instant,
  id: z.uuid(),
});
export type CommunityCommentCursor = z.output<
  typeof communityCommentCursorSchema
>;
export function communityCommentAfter(
  value: CommunityCommentCursor,
  before: CommunityCommentCursor,
) {
  const difference =
    timestampMicros(value.created_at) - timestampMicros(before.created_at);
  return difference > 0n || (difference === 0n && value.id > before.id);
}
export const communityInteractionsQuerySchema = z.strictObject({
  slug: artistSlugSchema,
  post_id: z.uuid(),
  cursor: communityCommentCursorSchema.nullable(),
});
export type CommunityInteractionsQuery = z.output<
  typeof communityInteractionsQuerySchema
>;
export const communityCommentSchema = z.strictObject({
  id: z.uuid(),
  post_id: z.uuid(),
  author: z.strictObject({ call_name: z.string().min(1).nullable() }),
  is_owner: z.boolean(),
  body,
  created_at: instant,
  updated_at: instant,
  revision,
});
export type CommunityComment = z.output<typeof communityCommentSchema>;
export const communityInteractionsSchema = z
  .strictObject({
    actor_id: z.uuid(),
    post_id: z.uuid(),
    policy: z.strictObject({
      max_comment_length: z
        .number()
        .int()
        .positive()
        .max(COMMUNITY_INTERACTIONS.bodyMax),
    }),
    like_count: z.number().int().nonnegative().safe(),
    comment_count: z.number().int().nonnegative().safe(),
    liked: z.boolean(),
    comments: z
      .array(communityCommentSchema)
      .max(COMMUNITY_INTERACTIONS.pageSize),
    next_cursor: communityCommentCursorSchema.nullable(),
  })
  .refine((page) => {
    const ids = new Set<string>();
    let previous: CommunityCommentCursor | undefined;
    for (const comment of page.comments) {
      if (
        comment.post_id !== page.post_id ||
        ids.has(comment.id) ||
        (previous && !communityCommentAfter(comment, previous))
      )
        return false;
      ids.add(comment.id);
      previous = comment;
    }
    const last = page.comments.at(-1);
    return (
      page.comment_count >= page.comments.length &&
      (!page.liked || page.like_count > 0) &&
      (!page.next_cursor ||
        (page.comments.length === COMMUNITY_INTERACTIONS.pageSize &&
          last !== undefined &&
          page.next_cursor.id === last.id &&
          page.next_cursor.created_at === last.created_at))
    );
  });
export type CommunityInteractions = z.output<
  typeof communityInteractionsSchema
>;
const operation = { operation_id: z.uuid(), post_id: z.uuid() };
const commentOperation = { ...operation, comment_id: z.uuid() };
export const communityCommentCreateSchema = z.strictObject({
  ...commentOperation,
  body,
});
export type CommunityCommentCreateInput = z.output<
  typeof communityCommentCreateSchema
>;
export const communityCommentUpdateSchema = z.strictObject({
  ...commentOperation,
  expected_revision: mutableRevision,
  body,
});
export type CommunityCommentUpdateInput = z.output<
  typeof communityCommentUpdateSchema
>;
export const communityCommentDeleteSchema = z.strictObject({
  ...commentOperation,
  expected_revision: mutableRevision,
  confirmed: z.literal(true),
});
export type CommunityCommentDeleteInput = z.output<
  typeof communityCommentDeleteSchema
>;
export const communityLikeSchema = z.strictObject({
  ...operation,
  liked: z.boolean(),
});
export type CommunityLikeInput = z.output<typeof communityLikeSchema>;
export const communityCommentReceiptSchema = z.strictObject({
  id: z.uuid(),
  post_id: z.uuid(),
  revision,
});
export type CommunityCommentReceipt = z.output<
  typeof communityCommentReceiptSchema
>;
export const communityCommentDeletedSchema = z.strictObject({
  id: z.uuid(),
  post_id: z.uuid(),
  deleted: z.literal(true),
});
export type CommunityCommentDeleted = z.output<
  typeof communityCommentDeletedSchema
>;
export const communityLikeReceiptSchema = z.strictObject({
  post_id: z.uuid(),
  liked: z.boolean(),
});
export type CommunityLikeReceipt = z.output<typeof communityLikeReceiptSchema>;
