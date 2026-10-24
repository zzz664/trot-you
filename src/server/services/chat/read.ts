import 'server-only';
import { z } from 'zod';
import {
  CHAT_MAX_PAGE_SIZE,
  CHAT_PAGE_SIZE,
  chatPageInputSchema,
  chatReadInputSchema,
  type ChatPage,
  type ChatReadReceipt,
  type ChatResult,
} from '@/config/chat';
import { artistSlugSchema, type ArtistSummary } from '@/config/artists';
import { renderMessage } from '@/server/services/message/render';

export type ChatCursor = { slug: string; sentAt: string; id: string };
export type RawChatPage = {
  artist: ArtistSummary;
  callName: string;
  hasAccess: boolean;
  messages: {
    id: string;
    kind: 'text' | 'photo' | 'voice' | 'video';
    template: string | null;
    sentAt: string;
    readAt: string | null;
    media: { id: string; kind: 'photo' | 'voice' | 'video' }[];
  }[];
  readCount: number;
  hasMore: boolean;
};
export type ChatPagePort = {
  page(
    actorId: string,
    slug: string,
    limit: number,
    before: ChatCursor | null,
  ): Promise<ChatResult<RawChatPage>>;
};
export type ChatReadPort = {
  mark(
    slug: string,
    messageId: string,
  ): Promise<ChatResult<{ readAt: string; readCount: number }>>;
};
const cursorPayloadSchema = z.strictObject({
  slug: artistSlugSchema,
  sentAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

export function encodeChatCursor(cursor: ChatCursor) {
  // Keep PostgreSQL's full fractional-second timestamp, never round-trip Date.
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
export function decodeChatCursor(
  value: string,
  slug: string,
): ChatCursor | null {
  try {
    const buffer = Buffer.from(value, 'base64url');
    if (buffer.toString('base64url') !== value) return null;
    const parsed = cursorPayloadSchema.safeParse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)),
    );
    return parsed.success && parsed.data.slug === slug ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function readChatPage(
  port: ChatPagePort,
  actorId: string,
  input: unknown,
): Promise<ChatResult<ChatPage>> {
  const parsed = chatPageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  if (!z.uuid().safeParse(actorId).success)
    return { ok: false, code: 'FORBIDDEN' };
  const { slug, cursor, limit = CHAT_PAGE_SIZE } = parsed.data;
  const before = cursor ? decodeChatCursor(cursor, slug) : null;
  if (cursor && !before) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.page(actorId, slug, limit, before);
    if (!result.ok) return result;
    const page = result.data;
    if (
      page.artist.slug !== slug ||
      page.messages.length > Math.min(limit, CHAT_MAX_PAGE_SIZE) ||
      new Set(page.messages.map((m) => m.id)).size !== page.messages.length ||
      (page.hasMore && page.messages.length === 0)
    )
      return { ok: false, code: 'UNAVAILABLE' };
    const messages = page.hasAccess
      ? page.messages.map((message) => ({
          id: message.id,
          kind: message.kind,
          text: renderMessage(message.template, page.callName),
          sentAt: message.sentAt,
          readAt: message.readAt,
          media: message.media.map((media) => ({
            id: media.id,
            kind: media.kind,
            availability: 'available' as const,
          })),
        }))
      : [];
    const last = messages.at(-1);
    return {
      ok: true,
      data: {
        artist: {
          slug: page.artist.slug,
          name: page.artist.name,
          description: page.artist.description,
        },
        hasAccess: page.hasAccess,
        messages,
        nextCursor:
          page.hasAccess && page.hasMore && last
            ? encodeChatCursor({ slug, sentAt: last.sentAt, id: last.id })
            : null,
        readCount: page.hasAccess ? page.readCount : 0,
      },
    };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}

export async function markChatRead(
  port: ChatReadPort,
  input: unknown,
): Promise<ChatResult<ChatReadReceipt>> {
  const parsed = chatReadInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.mark(parsed.data.slug, parsed.data.messageId);
    return result.ok
      ? {
          ok: true,
          data: {
            messageId: parsed.data.messageId,
            readAt: result.data.readAt,
            readCount: result.data.readCount,
          },
        }
      : result;
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
