import 'server-only';
import { z } from 'zod';
import { artistSlugSchema } from '@/config/artists';
import {
  REPLY_MAX_PAGE_SIZE,
  ownReplySchema,
  type ReplyError,
  type ReplyResult,
} from '@/config/replies';
import type { ReplyPort } from '@/server/services/replies/replies';
import type { ActorClient } from './client';

const codes: Record<string, ReplyError> = {
  REPLY_INVALID_INPUT: 'INVALID_INPUT',
  REPLY_CONTENT_INVALID: 'INVALID_INPUT',
  REPLY_TOO_LONG: 'TOO_LONG',
  REPLY_CONTENT_BLOCKED: 'FORBIDDEN_CONTENT',
  REPLY_FORBIDDEN_CONTENT: 'FORBIDDEN_CONTENT',
  REPLY_FORBIDDEN: 'FORBIDDEN',
  REPLY_SUBSCRIPTION_REQUIRED: 'SUBSCRIPTION_REQUIRED',
  REPLY_PROFILE_REQUIRED: 'PROFILE_REQUIRED',
  REPLY_NOT_FOUND: 'NOT_FOUND',
  REPLY_IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  REPLY_OPERATION_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  REPLY_MESSAGE_NOT_VISIBLE: 'FORBIDDEN',
  REPLY_RATE_LIMITED: 'RATE_LIMITED',
  REPLY_SETUP_NOT_READY: 'SETUP_NOT_READY',
  REPLY_POLICY_REQUIRED: 'SETUP_NOT_READY',
  REPLY_POLICY_INVALID: 'SETUP_NOT_READY',
  MESSAGE_POLICY_REQUIRED: 'SETUP_NOT_READY',
  MESSAGE_NOT_VISIBLE: 'FORBIDDEN',
  DISCOVERY_FORBIDDEN: 'FORBIDDEN',
  DISCOVERY_PROFILE_REQUIRED: 'PROFILE_REQUIRED',
  DISCOVERY_SETUP_NOT_READY: 'SETUP_NOT_READY',
};
function failure(message: string): ReplyResult<never> {
  return {
    ok: false,
    code: Object.hasOwn(codes, message) ? codes[message]! : 'UNAVAILABLE',
  };
}
const rowSchema = z
  .object({
    id: z.uuid(),
    operation_id: z.uuid().nullable(),
    message_id: z.uuid().nullable(),
    body: z.string().nullable(),
    is_blocked: z.boolean(),
    created_at: z.iso.datetime({ offset: true }),
  })
  .transform((row) => ({
    id: row.id,
    operationId: row.operation_id,
    messageId: row.message_id,
    body: row.body,
    blocked: row.is_blocked,
    createdAt: row.created_at,
  }))
  .pipe(ownReplySchema);
const pageSchema = z.object({
  artist_slug: artistSlugSchema,
  max_length: z.number().int().positive(),
  send_ready: z.boolean(),
  replies: z.array(rowSchema).max(REPLY_MAX_PAGE_SIZE),
  has_more: z.boolean(),
});
export function createReplyPort(client: ActorClient): ReplyPort {
  return {
    async page(slug, limit, before) {
      const { data, error } = await client
        .rpc('fan_reply_page', {
          p_artist_slug: slug,
          p_limit: limit,
          ...(before
            ? { p_before_created_at: before.createdAt, p_before_id: before.id }
            : {}),
        })
        .single();
      if (error) return failure(error.message);
      const parsed = pageSchema.safeParse(data);
      return parsed.success
        ? {
            ok: true,
            data: {
              slug: parsed.data.artist_slug,
              maxLength: parsed.data.max_length,
              sendReady: parsed.data.send_ready,
              replies: parsed.data.replies,
              hasMore: parsed.data.has_more,
            },
          }
        : { ok: false, code: 'UNAVAILABLE' };
    },
    async send(slug, operationId, body, messageId) {
      const { data, error } = await client
        .rpc('fan_reply_send', {
          p_artist_slug: slug,
          p_operation_id: operationId,
          p_body: body,
          ...(messageId !== null ? { p_message_id: messageId } : {}),
        })
        .single();
      if (error) return failure(error.message);
      const parsed = rowSchema.safeParse(data);
      return parsed.success
        ? { ok: true, data: parsed.data }
        : { ok: false, code: 'UNAVAILABLE' };
    },
  };
}
