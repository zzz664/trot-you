import { z } from 'zod';
import {
  CHAT_ERROR_STATUS,
  CHAT_REQUEST_TIMEOUT_MS,
  CHAT_RESPONSE_MAX_BYTES,
  chatPageInputSchema,
  chatPageSchema,
  chatReadInputSchema,
  chatReadReceiptSchema,
  type ChatError,
  type ChatPage,
  type ChatPageInput,
  type ChatReadInput,
  type ChatReadReceipt,
  type ChatResult,
} from '@/config/chat';
import { chatMessagesPath, chatReadPath } from '@/config/routes';

async function chatRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
  write = false,
): Promise<ChatResult<T>> {
  if (signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
  try {
    const timeout = AbortSignal.timeout(CHAT_REQUEST_TIMEOUT_MS);
    const response = await fetch(path, {
      method: write ? 'POST' : 'GET',
      ...(write && {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
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
    let text = '';
    let bytes = 0;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > CHAT_RESPONSE_MAX_BYTES) {
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
      return response.ok ? parsed.data : { ok: false, code: 'UNAVAILABLE' };
    if (Object.hasOwn(CHAT_ERROR_STATUS, parsed.data.code)) {
      const code = parsed.data.code as ChatError;
      if (response.status === CHAT_ERROR_STATUS[code])
        return { ok: false, code };
    }
  } catch {
    // A read mark may already be committed. Its only retry is the same
    // idempotent resource operation after an explicit user action, never here.
  }
  return { ok: false, code: 'UNAVAILABLE' };
}

export async function readChatPage(
  input: ChatPageInput,
  signal?: AbortSignal,
): Promise<ChatResult<ChatPage>> {
  const parsed = chatPageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const query = new URLSearchParams();
  if (parsed.data.cursor) query.set('cursor', parsed.data.cursor);
  if (parsed.data.limit) query.set('limit', String(parsed.data.limit));
  const path = chatMessagesPath(parsed.data.slug);
  const result = await chatRequest(
    query.size ? `${path}?${query}` : path,
    chatPageSchema,
    signal,
  );
  if (
    result.ok &&
    (result.data.artist.slug !== parsed.data.slug ||
      (parsed.data.limit !== undefined &&
        result.data.messages.length > parsed.data.limit) ||
      (parsed.data.cursor !== undefined &&
        result.data.nextCursor === parsed.data.cursor) ||
      new Set(result.data.messages.map((message) => message.id)).size !==
        result.data.messages.length ||
      (result.data.nextCursor !== null && result.data.messages.length === 0))
  )
    return { ok: false, code: 'UNAVAILABLE' };
  return result;
}

export async function markChatRead(
  input: ChatReadInput,
  signal?: AbortSignal,
): Promise<ChatResult<ChatReadReceipt>> {
  const parsed = chatReadInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const result = await chatRequest(
    chatReadPath(parsed.data.slug, parsed.data.messageId),
    chatReadReceiptSchema,
    signal,
    true,
  );
  return result.ok && result.data.messageId !== parsed.data.messageId
    ? { ok: false, code: 'UNAVAILABLE' }
    : result;
}
