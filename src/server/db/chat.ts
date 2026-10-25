import 'server-only';
import { z } from 'zod';
import {
  CHAT_MAX_PAGE_SIZE,
  type ChatError,
  type ChatResult,
} from '@/config/chat';
import { artistSlugSchema } from '@/config/artists';
import type { ChatPagePort, ChatReadPort } from '@/server/services/chat/read';
import type { ActorClient } from './client';
import type { ChatServiceClient } from './chat-client';

function failure(message: string): ChatResult<never> {
  const codes: Record<string, ChatError> = {
    CHAT_INVALID_INPUT: 'INVALID_INPUT',
    CHAT_NOT_FOUND: 'NOT_FOUND',
    CHAT_FORBIDDEN: 'FORBIDDEN',
    CHAT_SUBSCRIPTION_REQUIRED: 'SUBSCRIPTION_REQUIRED',
    CHAT_PROFILE_REQUIRED: 'PROFILE_REQUIRED',
    CHAT_SETUP_NOT_READY: 'SETUP_NOT_READY',
    MESSAGE_NOT_VISIBLE: 'FORBIDDEN',
    MESSAGE_PAGE_INVALID: 'INVALID_INPUT',
    MESSAGE_POLICY_REQUIRED: 'SETUP_NOT_READY',
    DISCOVERY_FORBIDDEN: 'FORBIDDEN',
    DISCOVERY_PROFILE_REQUIRED: 'PROFILE_REQUIRED',
    DISCOVERY_SETUP_NOT_READY: 'SETUP_NOT_READY',
  };
  return {
    ok: false,
    code: Object.hasOwn(codes, message) ? codes[message]! : 'UNAVAILABLE',
  };
}
const instant = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative().safe();
const pageSchema = z
  .object({
    artist_id: z.uuid(),
    artist_slug: artistSlugSchema,
    artist_name: z.string().min(1),
    artist_intro: z.string().nullable(),
    call_name: z.string().min(1),
    has_access: z.boolean(),
    read_count: count,
    has_more: z.boolean(),
    messages: z
      .array(
        z.object({
          id: z.uuid(),
          type: z.enum(['text', 'photo', 'voice', 'video']),
          body_template: z.string().nullable(),
          sent_at: instant,
          read_at: instant.nullable(),
          media: z.array(
            z.object({
              id: z.uuid(),
              kind: z.enum(['photo', 'voice', 'video']),
            }),
          ),
        }),
      )
      .max(CHAT_MAX_PAGE_SIZE),
  })
  .refine(
    (page) =>
      page.has_access ||
      (page.messages.length === 0 && page.read_count === 0 && !page.has_more),
  );

export function createChatPagePort(client: ChatServiceClient): ChatPagePort {
  return {
    async page(actorId, slug, limit, before) {
      // An unavailable/invalid operational read fails closed. The database owns
      // the explicit compatibility default, not a hidden client fallback.
      const settings = await client.rpc('chat_settings');
      const parsedSettings = z
        .strictObject({
          page_size: z.number().int().min(1).max(CHAT_MAX_PAGE_SIZE),
        })
        .safeParse(settings.data);
      if (settings.error || !parsedSettings.success)
        return { ok: false, code: 'UNAVAILABLE' };
      const { data, error } = await client
        .rpc('fan_chat_page', {
          p_actor_id: actorId,
          p_artist_slug: slug,
          p_limit: limit ?? parsedSettings.data.page_size,
          ...(before
            ? { p_before_sent_at: before.sentAt, p_before_id: before.id }
            : {}),
        })
        .single();
      if (error) return failure(error.message);
      const parsed = pageSchema.safeParse(data);
      if (!parsed.success) return { ok: false, code: 'UNAVAILABLE' };
      const row = parsed.data;
      return {
        ok: true,
        data: {
          artist: {
            slug: row.artist_slug,
            name: row.artist_name,
            description: row.artist_intro,
          },
          callName: row.call_name,
          hasAccess: row.has_access,
          readCount: row.read_count,
          hasMore: row.has_more,
          messages: row.messages.map((message) => ({
            id: message.id,
            kind: message.type,
            template: message.body_template,
            sentAt: message.sent_at,
            readAt: message.read_at,
            media: message.media.map((media) => ({
              id: media.id,
              kind: media.kind,
            })),
          })),
        },
      };
    },
  };
}
export function createChatReadPort(client: ActorClient): ChatReadPort {
  return {
    async mark(slug, messageId) {
      const { data, error } = await client
        .rpc('fan_chat_mark_read', {
          p_artist_slug: slug,
          p_message_id: messageId,
        })
        .single();
      if (error) return failure(error.message);
      const parsed = z
        .object({ read_at: instant, read_count: count })
        .safeParse(data);
      return parsed.success
        ? {
            ok: true,
            data: {
              readAt: parsed.data.read_at,
              readCount: parsed.data.read_count,
            },
          }
        : { ok: false, code: 'UNAVAILABLE' };
    },
  };
}
