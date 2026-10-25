import 'server-only';
import { artistSlugSchema } from '@/config/artists';
import {
  communityCreateSchema,
  communityDeleteSchema,
  communityNoticeSchema,
  communityCreatedSchema,
  communityDeletedSchema,
  communityNoticeReceiptSchema,
  type CommunityResult,
  type CommunityCreateInput,
  type CommunityDeleteInput,
  type CommunityNoticeInput,
  type CommunityCreated,
  type CommunityDeleted,
  type CommunityNoticeReceipt,
} from '@/config/community-posts';
export type CommunityWritePort = {
  create(
    slug: string,
    input: CommunityCreateInput,
  ): Promise<CommunityResult<CommunityCreated>>;
  delete(
    slug: string,
    input: CommunityDeleteInput,
  ): Promise<CommunityResult<CommunityDeleted>>;
  notice(
    slug: string,
    input: CommunityNoticeInput,
  ): Promise<CommunityResult<CommunityNoticeReceipt>>;
};
export async function createCommunityPost(
  port: CommunityWritePort,
  slug: unknown,
  input: unknown,
): Promise<CommunityResult<CommunityCreated>> {
  const artist = artistSlugSchema.safeParse(slug),
    parsed = communityCreateSchema.safeParse(input);
  if (!artist.success || !parsed.success)
    return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.create(artist.data, parsed.data);
    if (!result.ok) return result;
    const receipt = communityCreatedSchema.safeParse(result.data);
    return receipt.success &&
      receipt.data.id === parsed.data.post_id &&
      receipt.data.artist_id === parsed.data.artist_id &&
      receipt.data.revision === 1
      ? { ok: true, data: receipt.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function deleteCommunityPost(
  port: CommunityWritePort,
  slug: unknown,
  input: unknown,
): Promise<CommunityResult<CommunityDeleted>> {
  const artist = artistSlugSchema.safeParse(slug),
    parsed = communityDeleteSchema.safeParse(input);
  if (!artist.success || !parsed.success)
    return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.delete(artist.data, parsed.data);
    if (!result.ok) return result;
    const receipt = communityDeletedSchema.safeParse(result.data);
    return receipt.success && receipt.data.id === parsed.data.post_id
      ? { ok: true, data: receipt.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function setCommunityNotice(
  port: CommunityWritePort,
  slug: unknown,
  input: unknown,
): Promise<CommunityResult<CommunityNoticeReceipt>> {
  const artist = artistSlugSchema.safeParse(slug),
    parsed = communityNoticeSchema.safeParse(input);
  if (!artist.success || !parsed.success)
    return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.notice(artist.data, parsed.data);
    if (!result.ok) return result;
    const receipt = communityNoticeReceiptSchema.safeParse(result.data);
    return receipt.success &&
      receipt.data.id === parsed.data.post_id &&
      receipt.data.is_notice === parsed.data.is_notice &&
      receipt.data.is_pinned === parsed.data.is_pinned &&
      (receipt.data.revision === parsed.data.expected_revision ||
        receipt.data.revision === parsed.data.expected_revision + 1)
      ? { ok: true, data: receipt.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
