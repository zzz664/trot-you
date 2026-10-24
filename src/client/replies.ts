import { z } from 'zod';
import {
  REPLY_ERROR_STATUS,
  REPLY_HTTP_OK,
  REPLY_REQUEST_TIMEOUT_MS,
  REPLY_RESPONSE_MAX_BYTES,
  replyPageInputSchema,
  replyPageSchema,
  replyWriteInputSchema,
  replyReceiptSchema,
  type ReplyError,
  type ReplyPage,
  type ReplyPageInput,
  type ReplyWriteInput,
  type ReplyReceipt,
  type ReplyResult,
} from '@/config/replies';
import { fanRepliesPath } from '@/config/routes';

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
  body?: { operationId: string; body: string; messageId: string | null },
): Promise<ReplyResult<T>> {
  if (signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
  try {
    const timeout = AbortSignal.timeout(REPLY_REQUEST_TIMEOUT_MS);
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET',
      ...(body && {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (
      response.headers.get('content-type')?.split(';')[0]?.trim() !==
      'application/json'
    )
      return { ok: false, code: 'UNAVAILABLE' };
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, code: 'UNAVAILABLE' };
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    let text = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > REPLY_RESPONSE_MAX_BYTES) {
          await reader.cancel();
          return { ok: false, code: 'UNAVAILABLE' };
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const parsed = z
      .union([
        z.strictObject({ ok: z.literal(true), data: schema }),
        z.strictObject({ ok: z.literal(false), code: z.string() }),
      ])
      .safeParse(JSON.parse(text));
    if (!parsed.success) return { ok: false, code: 'UNAVAILABLE' };
    if (parsed.data.ok)
      return response.status === REPLY_HTTP_OK
        ? parsed.data
        : { ok: false, code: 'UNAVAILABLE' };
    if (Object.hasOwn(REPLY_ERROR_STATUS, parsed.data.code)) {
      const code = parsed.data.code as ReplyError;
      if (response.status === REPLY_ERROR_STATUS[code])
        return { ok: false, code };
    }
  } catch {
    // A committed reply can outlive its response. Never mint another operation
    // or automatically retry a write here: the owner retains its original key.
  }
  return { ok: false, code: 'UNAVAILABLE' };
}

export async function readReplyPage(
  input: ReplyPageInput,
  signal?: AbortSignal,
): Promise<ReplyResult<ReplyPage>> {
  const parsed = replyPageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const query = new URLSearchParams();
  if (parsed.data.cursor) query.set('cursor', parsed.data.cursor);
  if (parsed.data.limit) query.set('limit', String(parsed.data.limit));
  const path = fanRepliesPath(parsed.data.slug);
  const result = await request(
    query.size ? `${path}?${query}` : path,
    replyPageSchema,
    signal,
  );
  if (
    result.ok &&
    (result.data.slug !== parsed.data.slug ||
      (parsed.data.limit !== undefined &&
        result.data.replies.length > parsed.data.limit) ||
      (parsed.data.cursor !== undefined &&
        result.data.nextCursor === parsed.data.cursor) ||
      new Set(result.data.replies.map((reply) => reply.id)).size !==
        result.data.replies.length ||
      (result.data.nextCursor !== null && result.data.replies.length === 0))
  )
    return { ok: false, code: 'UNAVAILABLE' };
  return result;
}

export async function sendReply(
  input: ReplyWriteInput,
  signal?: AbortSignal,
): Promise<ReplyResult<ReplyReceipt>> {
  const parsed = replyWriteInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const { slug, ...body } = parsed.data;
  const result = await request(
    fanRepliesPath(slug),
    replyReceiptSchema,
    signal,
    body,
  );
  if (
    result.ok &&
    (result.data.slug !== slug ||
      result.data.reply.operationId !== body.operationId ||
      result.data.reply.messageId !== body.messageId ||
      (!result.data.reply.blocked && result.data.reply.body !== body.body))
  )
    return { ok: false, code: 'UNAVAILABLE' };
  return result;
}
