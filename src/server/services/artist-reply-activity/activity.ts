import 'server-only';
import { z } from 'zod';
import { artistSlugSchema } from '@/config/artists';
import {
  artistReplyActivityPageInputSchema,
  artistReplyActivityMessagesInputSchema,
  artistReplyActivityPageSchema,
  artistReplyActivityMessagesSchema,
  artistReplyActivityCatalogSchema,
  type ArtistReplyActivityPage,
  type ArtistReplyActivityMessages,
  type ArtistReplyActivityCatalog,
  type ArtistReplyActivityResult,
} from '@/config/artist-reply-activity';

export type ActivityReplyCursor = {
  kind: 'replies';
  slug: string;
  messageId: string | null;
  createdAt: string;
  id: string;
};
export type ActivityMessageCursor = {
  kind: 'messages';
  slug: string;
  sentAt: string;
  id: string;
};
export type RawArtistReplyActivityPage = Omit<
  ArtistReplyActivityPage,
  'nextCursor'
>;
export type RawArtistReplyActivityMessages = Omit<
  ArtistReplyActivityMessages,
  'nextCursor'
>;
export type ArtistReplyActivityPort = {
  context(
    slug: string,
    messageId: string | null,
    before: ActivityReplyCursor | null,
  ): Promise<ArtistReplyActivityResult<RawArtistReplyActivityPage>>;
  messages(
    slug: string,
    before: ActivityMessageCursor | null,
  ): Promise<ArtistReplyActivityResult<RawArtistReplyActivityMessages>>;
};
export type ArtistReplyActivityCatalogPort = {
  artists(
    afterSlug: string | null,
  ): Promise<
    ArtistReplyActivityResult<Omit<ArtistReplyActivityCatalog, 'nextSlug'>>
  >;
};
const replyCursorSchema = z.strictObject({
  kind: z.literal('replies'),
  slug: artistSlugSchema,
  messageId: z.uuid().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});
const messageCursorSchema = z.strictObject({
  kind: z.literal('messages'),
  slug: artistSlugSchema,
  sentAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});
function decode<T>(value: string, schema: z.ZodType<T>): T | null {
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) return null;
    const parsed = schema.safeParse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function encode(value: ActivityReplyCursor | ActivityMessageCursor) {
  // Exact source timestamp strings preserve PostgreSQL microseconds.
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
export async function readArtistReplyActivityPage(
  port: ArtistReplyActivityPort,
  input: unknown,
): Promise<ArtistReplyActivityResult<ArtistReplyActivityPage>> {
  const parsed = artistReplyActivityPageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const { slug, messageId, cursor } = parsed.data;
  const before = cursor ? decode(cursor, replyCursorSchema) : null;
  if (
    cursor &&
    (!before || before.slug !== slug || before.messageId !== messageId)
  )
    return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.context(slug, messageId, before);
    if (!result.ok) return result;
    const checked = artistReplyActivityPageSchema
      .omit({ nextCursor: true })
      .safeParse(result.data);
    if (!checked.success) return { ok: false, code: 'UNAVAILABLE' };
    const page = checked.data;
    const last = page.replies.at(-1);
    if (
      page.artist.slug !== slug ||
      (messageId === null
        ? page.selectedMessage !== null
        : page.selectedMessage?.id !== messageId) ||
      (page.hasMore && !last) ||
      new Set(page.replies.map((row) => row.id)).size !== page.replies.length ||
      (messageId !== null &&
        page.replies.some((row) => row.messageId !== messageId))
    )
      return { ok: false, code: 'UNAVAILABLE' };
    const nextCursor =
      page.hasMore && last
        ? encode({
            kind: 'replies',
            slug,
            messageId,
            createdAt: last.createdAt,
            id: last.id,
          })
        : null;
    if (cursor && cursor === nextCursor)
      return { ok: false, code: 'UNAVAILABLE' };
    return { ok: true, data: { ...page, nextCursor } };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function readArtistReplyActivityMessages(
  port: ArtistReplyActivityPort,
  input: unknown,
): Promise<ArtistReplyActivityResult<ArtistReplyActivityMessages>> {
  const parsed = artistReplyActivityMessagesInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const { slug, cursor } = parsed.data;
  const before = cursor ? decode(cursor, messageCursorSchema) : null;
  if (cursor && (!before || before.slug !== slug))
    return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.messages(slug, before);
    if (!result.ok) return result;
    const checked = artistReplyActivityMessagesSchema
      .omit({ nextCursor: true })
      .safeParse(result.data);
    if (!checked.success) return { ok: false, code: 'UNAVAILABLE' };
    const page = checked.data;
    const last = page.messages.at(-1);
    if (
      page.artist.slug !== slug ||
      (page.hasMore && !last) ||
      new Set(page.messages.map((row) => row.id)).size !== page.messages.length
    )
      return { ok: false, code: 'UNAVAILABLE' };
    const nextCursor =
      page.hasMore && last
        ? encode({ kind: 'messages', slug, sentAt: last.sentAt, id: last.id })
        : null;
    if (cursor && cursor === nextCursor)
      return { ok: false, code: 'UNAVAILABLE' };
    return { ok: true, data: { ...page, nextCursor } };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function readArtistReplyActivityArtists(
  port: ArtistReplyActivityCatalogPort,
  input: unknown,
): Promise<ArtistReplyActivityResult<ArtistReplyActivityCatalog>> {
  const after = artistSlugSchema.nullable().safeParse(input);
  if (!after.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.artists(after.data);
    if (!result.ok) return result;
    const checked = artistReplyActivityCatalogSchema
      .omit({ nextSlug: true })
      .safeParse(result.data);
    if (!checked.success) return { ok: false, code: 'UNAVAILABLE' };
    const page = checked.data;
    const last = page.artists.at(-1);
    if (
      (page.hasMore && !last) ||
      new Set(page.artists.map((row) => row.slug)).size !==
        page.artists.length ||
      page.artists.some((row) => after.data !== null && row.slug <= after.data)
    )
      return { ok: false, code: 'UNAVAILABLE' };
    return {
      ok: true,
      data: { ...page, nextSlug: page.hasMore && last ? last.slug : null },
    };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
