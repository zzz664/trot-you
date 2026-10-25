import { z } from 'zod';
import { artistSlugSchema } from './artists';

// Transport/schema ceilings only. Actual posting/image limits come from the
// explicitly configured community policy; no policy is activated by this file.
export const COMMUNITY_POSTS = {
  actorHeader: 'X-Community-Actor',
  pageSize: 20,
  titleMax: 1000,
  bodyMax: 100000,
  imageMax: 100,
  imageByteMax: 10485760,
  imageEdgeMax: 100000,
  cursorMax: 512,
  bodyLimit: 512 * 1024,
  bodyTimeoutMs: 5000,
  requestTimeoutMs: 15000,
  responseMaxBytes: 32 * 1024 * 1024,
  httpOk: 200,
  maxMutableRevision: Number.MAX_SAFE_INTEGER - 1,
} as const;
export const COMMUNITY_ERROR_STATUS = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  CONFIRMATION_REQUIRED: 400,
  CONTENT_BLOCKED: 422,
  RATE_LIMITED: 429,
  LIMIT_EXCEEDED: 409,
  EXPIRED: 410,
  INVALID_CONTENT: 422,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export type CommunityError = keyof typeof COMMUNITY_ERROR_STATUS;
export type CommunityResult<T> =
  { ok: true; data: T } | { ok: false; code: CommunityError };
const instant = z.iso
  .datetime({ offset: true })
  .refine(
    (value) =>
      !value.startsWith('0000-') &&
      (value.match(/\.(\d+)/)?.[1]?.length ?? 0) <= 6,
  );
const revision = z.number().int().positive().safe();
const text = (max: number) =>
  z
    .string()
    .refine((value) => value.length > 0 && Array.from(value).length <= max);
const authoredText = (max: number) =>
  text(max).refine(
    (value) =>
      value.trim().length > 0 &&
      !/[\p{Cc}\p{Cs}]/u.test(value.replace(/[\n\r\t]/g, '')),
  );
export const communityArtistSchema = z.strictObject({
  id: z.uuid(),
  slug: artistSlugSchema,
  name: z.string().min(1),
});
export const communityPolicySchema = z.strictObject({
  max_title_length: z.number().int().positive().max(COMMUNITY_POSTS.titleMax),
  max_body_length: z.number().int().positive().max(COMMUNITY_POSTS.bodyMax),
  max_images: z.number().int().nonnegative().max(COMMUNITY_POSTS.imageMax),
  max_image_bytes: z
    .number()
    .int()
    .positive()
    .max(COMMUNITY_POSTS.imageByteMax),
  max_image_long_edge: z
    .number()
    .int()
    .positive()
    .max(COMMUNITY_POSTS.imageEdgeMax),
});
export type CommunityPolicy = z.output<typeof communityPolicySchema>;
export const communityCursorSchema = z.strictObject({
  is_pinned: z.boolean(),
  created_at: instant,
  id: z.uuid(),
});
export type CommunityCursor = z.output<typeof communityCursorSchema>;
export const communityListQuerySchema = z.strictObject({
  slug: artistSlugSchema,
  cursor: communityCursorSchema.nullable(),
});
export type CommunityListQuery = z.output<typeof communityListQuerySchema>;
export const communityDetailQuerySchema = z.strictObject({
  slug: artistSlugSchema,
  post_id: z.uuid(),
});
export type CommunityDetailQuery = z.output<typeof communityDetailQuerySchema>;
const summaryFields = {
  id: z.uuid(),
  artist_id: z.uuid(),
  author: z.strictObject({ call_name: z.string().min(1).nullable() }),
  is_owner: z.boolean(),
  title: text(COMMUNITY_POSTS.titleMax),
  is_notice: z.boolean(),
  is_pinned: z.boolean(),
  created_at: instant,
  updated_at: instant,
  revision,
  image_count: z.number().int().nonnegative().max(COMMUNITY_POSTS.imageMax),
};
export const communityPostSummarySchema = z
  .strictObject(summaryFields)
  .refine((row) => !row.is_pinned || row.is_notice);
export type CommunityPostSummary = z.output<typeof communityPostSummarySchema>;
export const communityImageSchema = z.strictObject({
  id: z.uuid(),
  mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  byte_size: z.number().int().positive().max(COMMUNITY_POSTS.imageByteMax),
  width: z.number().int().positive().max(COMMUNITY_POSTS.imageEdgeMax),
  height: z.number().int().positive().max(COMMUNITY_POSTS.imageEdgeMax),
});
export type CommunityImage = z.output<typeof communityImageSchema>;
export const communityPostSchema = z
  .strictObject({
    ...summaryFields,
    body: text(COMMUNITY_POSTS.bodyMax),
    images: z.array(communityImageSchema).max(COMMUNITY_POSTS.imageMax),
  })
  .refine(
    (row) =>
      (!row.is_pinned || row.is_notice) &&
      row.images.length === row.image_count &&
      new Set(row.images.map((image) => image.id)).size === row.images.length,
  );
export type CommunityPost = z.output<typeof communityPostSchema>;
const contextFields = {
  actor_id: z.uuid(),
  artist: communityArtistSchema,
  policy: communityPolicySchema,
  can_create_notice: z.boolean(),
};
// PostgreSQL timestamptz has microsecond precision; Date alone would collapse
// distinct rows created inside one millisecond and break cursor validation.
function timestampMicros(value: string) {
  const fraction = value.match(/\.(\d+)/)?.[1] ?? '';
  return (
    BigInt(Date.parse(value)) * 1000n +
    BigInt(fraction.padEnd(6, '0').slice(3, 6))
  );
}
export function communityCursorAfter(
  value: CommunityCursor,
  before: CommunityCursor,
) {
  if (value.is_pinned !== before.is_pinned) return !value.is_pinned;
  const difference =
    timestampMicros(value.created_at) - timestampMicros(before.created_at);
  return difference < 0n || (difference === 0n && value.id < before.id);
}
export const communityListSchema = z
  .strictObject({
    ...contextFields,
    posts: z.array(communityPostSummarySchema).max(COMMUNITY_POSTS.pageSize),
    next_cursor: communityCursorSchema.nullable(),
  })
  .refine((page) => {
    const ids = new Set<string>();
    let previous: CommunityCursor | undefined;
    for (const row of page.posts) {
      if (
        row.artist_id !== page.artist.id ||
        ids.has(row.id) ||
        (previous && !communityCursorAfter(row, previous))
      )
        return false;
      ids.add(row.id);
      previous = row;
    }
    const last = page.posts.at(-1);
    return (
      !page.next_cursor ||
      (page.posts.length === COMMUNITY_POSTS.pageSize &&
        last !== undefined &&
        page.next_cursor.id === last.id &&
        page.next_cursor.created_at === last.created_at &&
        page.next_cursor.is_pinned === last.is_pinned)
    );
  });
export type CommunityList = z.output<typeof communityListSchema>;
export const communityDetailSchema = z
  .strictObject({
    ...contextFields,
    post: communityPostSchema,
  })
  .refine((page) => page.post.artist_id === page.artist.id);
export type CommunityDetail = z.output<typeof communityDetailSchema>;
export const communityCreateSchema = z
  .strictObject({
    operation_id: z.uuid(),
    post_id: z.uuid(),
    artist_id: z.uuid(),
    title: authoredText(COMMUNITY_POSTS.titleMax),
    body: authoredText(COMMUNITY_POSTS.bodyMax),
    upload_ids: z.array(z.uuid()).max(COMMUNITY_POSTS.imageMax),
    is_notice: z.boolean(),
    is_pinned: z.boolean(),
  })
  .refine(
    (value) =>
      (!value.is_pinned || value.is_notice) &&
      new Set(value.upload_ids).size === value.upload_ids.length,
  );
export type CommunityCreateInput = z.output<typeof communityCreateSchema>;
export const communityDeleteSchema = z.strictObject({
  operation_id: z.uuid(),
  post_id: z.uuid(),
  expected_revision: revision,
  confirmed: z.literal(true),
});
export type CommunityDeleteInput = z.output<typeof communityDeleteSchema>;
export const communityNoticeSchema = z
  .strictObject({
    operation_id: z.uuid(),
    post_id: z.uuid(),
    expected_revision: revision.max(COMMUNITY_POSTS.maxMutableRevision),
    is_notice: z.boolean(),
    is_pinned: z.boolean(),
  })
  .refine((value) => !value.is_pinned || value.is_notice);
export type CommunityNoticeInput = z.output<typeof communityNoticeSchema>;
export const communityCreatedSchema = z.strictObject({
  id: z.uuid(),
  artist_id: z.uuid(),
  revision,
});
export type CommunityCreated = z.output<typeof communityCreatedSchema>;
export const communityDeletedSchema = z.strictObject({
  id: z.uuid(),
  deleted: z.literal(true),
});
export type CommunityDeleted = z.output<typeof communityDeletedSchema>;
export const communityNoticeReceiptSchema = z
  .strictObject({
    id: z.uuid(),
    artist_id: z.uuid(),
    revision,
    is_notice: z.boolean(),
    is_pinned: z.boolean(),
  })
  .refine((value) => !value.is_pinned || value.is_notice);
export type CommunityNoticeReceipt = z.output<
  typeof communityNoticeReceiptSchema
>;
