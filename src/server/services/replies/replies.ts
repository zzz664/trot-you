import 'server-only';
import { z } from 'zod';
import { artistSlugSchema } from '@/config/artists';
import {
  REPLY_PAGE_SIZE,
  replyPageInputSchema,
  replyPageSchema,
  replyReceiptSchema,
  replyWriteInputSchema,
  type OwnReply,
  type ReplyPage,
  type ReplyReceipt,
  type ReplyResult,
} from '@/config/replies';

export type ReplyCursor = { slug: string; createdAt: string; id: string };
export type RawReplyPage = {
  slug: string;
  maxLength: number;
  sendReady: boolean;
  replies: OwnReply[];
  hasMore: boolean;
};
export type ReplyPort = {
  page(
    slug: string,
    limit: number,
    before: ReplyCursor | null,
  ): Promise<ReplyResult<RawReplyPage>>;
  send(
    slug: string,
    operationId: string,
    body: string,
    messageId: string | null,
  ): Promise<ReplyResult<OwnReply>>;
};
const cursorSchema = z.strictObject({
  slug: artistSlugSchema,
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});
export function encodeReplyCursor(cursor: ReplyCursor) {
  // Preserve PostgreSQL microseconds rather than reserializing through JS Date.
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
export function decodeReplyCursor(
  value: string,
  slug: string,
): ReplyCursor | null {
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) return null;
    const parsed = cursorSchema.safeParse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    return parsed.success && parsed.data.slug === slug ? parsed.data : null;
  } catch {
    return null;
  }
}
export async function readReplyPage(
  port: ReplyPort,
  input: unknown,
): Promise<ReplyResult<ReplyPage>> {
  const parsed = replyPageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const { slug, cursor, limit = REPLY_PAGE_SIZE } = parsed.data;
  const before = cursor ? decodeReplyCursor(cursor, slug) : null;
  if (cursor && !before) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.page(slug, limit, before);
    if (!result.ok) return result;
    const page = result.data;
    if (
      page.slug !== slug ||
      page.replies.length > limit ||
      new Set(page.replies.map((row) => row.id)).size !== page.replies.length ||
      (page.hasMore && page.replies.length === 0)
    )
      return { ok: false, code: 'UNAVAILABLE' };
    const last = page.replies.at(-1);
    const output = replyPageSchema.safeParse({
      slug: page.slug,
      maxLength: page.maxLength,
      sendReady: page.sendReady,
      replies: page.replies,
      nextCursor:
        page.hasMore && last
          ? encodeReplyCursor({ slug, createdAt: last.createdAt, id: last.id })
          : null,
    });
    return output.success
      ? { ok: true, data: output.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function sendReply(
  port: ReplyPort,
  input: unknown,
): Promise<ReplyResult<ReplyReceipt>> {
  const parsed = replyWriteInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const { slug, operationId, body, messageId } = parsed.data;
  if (
    !body.trim() ||
    !body.isWellFormed() ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body)
  )
    return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.send(slug, operationId, body, messageId);
    if (!result.ok) return result;
    const reply = result.data;
    if (
      reply.operationId !== operationId ||
      reply.messageId !== messageId ||
      (!reply.blocked && reply.body !== body)
    )
      return { ok: false, code: 'UNAVAILABLE' };
    const output = replyReceiptSchema.safeParse({ slug, reply });
    return output.success
      ? { ok: true, data: output.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
