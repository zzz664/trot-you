import 'server-only';
import { z } from 'zod';
import { artistSlugSchema } from '@/config/artists';
import type { CommunityResult } from '@/config/community-posts';
import {
  communityCommentCreateSchema,
  communityCommentUpdateSchema,
  communityCommentDeleteSchema,
  communityLikeSchema,
  communityCommentReceiptSchema,
  communityCommentDeletedSchema,
  communityLikeReceiptSchema,
  type CommunityCommentCreateInput,
  type CommunityCommentUpdateInput,
  type CommunityCommentDeleteInput,
  type CommunityLikeInput,
  type CommunityCommentReceipt,
  type CommunityCommentDeleted,
  type CommunityLikeReceipt,
} from '@/config/community-interactions';
export type CommunityInteractionsWritePort = {
  create(
    slug: string,
    input: CommunityCommentCreateInput,
  ): Promise<CommunityResult<CommunityCommentReceipt>>;
  update(
    slug: string,
    input: CommunityCommentUpdateInput,
  ): Promise<CommunityResult<CommunityCommentReceipt>>;
  delete(
    slug: string,
    input: CommunityCommentDeleteInput,
  ): Promise<CommunityResult<CommunityCommentDeleted>>;
  like(
    slug: string,
    input: CommunityLikeInput,
  ): Promise<CommunityResult<CommunityLikeReceipt>>;
};
async function mutate<I, O>(
  slug: unknown,
  input: unknown,
  inputSchema: z.ZodType<I>,
  outputSchema: z.ZodType<O>,
  action: (slug: string, input: I) => Promise<CommunityResult<O>>,
  matches: (input: I, output: O) => boolean,
): Promise<CommunityResult<O>> {
  const artist = artistSlugSchema.safeParse(slug),
    parsed = inputSchema.safeParse(input);
  if (!artist.success || !parsed.success)
    return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await action(artist.data, parsed.data);
    if (!result.ok) return result;
    const receipt = outputSchema.safeParse(result.data);
    return receipt.success && matches(parsed.data, receipt.data)
      ? { ok: true, data: receipt.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export function createCommunityComment(
  port: CommunityInteractionsWritePort,
  slug: unknown,
  input: unknown,
) {
  return mutate(
    slug,
    input,
    communityCommentCreateSchema,
    communityCommentReceiptSchema,
    (s, i) => port.create(s, i),
    (i, r) =>
      r.id === i.comment_id && r.post_id === i.post_id && r.revision === 1,
  );
}
export function updateCommunityComment(
  port: CommunityInteractionsWritePort,
  slug: unknown,
  input: unknown,
) {
  return mutate(
    slug,
    input,
    communityCommentUpdateSchema,
    communityCommentReceiptSchema,
    (s, i) => port.update(s, i),
    (i, r) =>
      r.id === i.comment_id &&
      r.post_id === i.post_id &&
      (r.revision === i.expected_revision ||
        r.revision === i.expected_revision + 1),
  );
}
export function deleteCommunityComment(
  port: CommunityInteractionsWritePort,
  slug: unknown,
  input: unknown,
) {
  return mutate(
    slug,
    input,
    communityCommentDeleteSchema,
    communityCommentDeletedSchema,
    (s, i) => port.delete(s, i),
    (i, r) => r.id === i.comment_id && r.post_id === i.post_id,
  );
}
export function setCommunityLike(
  port: CommunityInteractionsWritePort,
  slug: unknown,
  input: unknown,
) {
  return mutate(
    slug,
    input,
    communityLikeSchema,
    communityLikeReceiptSchema,
    (s, i) => port.like(s, i),
    (i, r) => r.post_id === i.post_id && r.liked === i.liked,
  );
}
