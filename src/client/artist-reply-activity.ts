import { z } from 'zod';
import {
  ACTIVITY_ERROR_STATUS,
  ACTIVITY_HTTP_OK,
  ACTIVITY_REQUEST_TIMEOUT_MS,
  ACTIVITY_RESPONSE_MAX_BYTES,
  artistReplyActivityPageInputSchema,
  artistReplyActivityMessagesInputSchema,
  artistReplyActivityPageSchema,
  artistReplyActivityMessagesSchema,
  type ArtistReplyActivityError,
  type ArtistReplyActivityResult,
  type ArtistReplyActivityPage,
  type ArtistReplyActivityMessages,
  type ArtistReplyActivityPageInput,
  type ArtistReplyActivityMessagesInput,
} from '@/config/artist-reply-activity';
import { artistReplyActivityApiPath } from '@/config/routes';

async function request<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<ArtistReplyActivityResult<T>> {
  if (signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
  try {
    const timeout = AbortSignal.timeout(ACTIVITY_REQUEST_TIMEOUT_MS);
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
    let size = 0;
    let text = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > ACTIVITY_RESPONSE_MAX_BYTES) {
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
      return response.status === ACTIVITY_HTTP_OK
        ? parsed.data
        : { ok: false, code: 'UNAVAILABLE' };
    if (Object.hasOwn(ACTIVITY_ERROR_STATUS, parsed.data.code)) {
      const code = parsed.data.code as ArtistReplyActivityError;
      if (response.status === ACTIVITY_ERROR_STATUS[code])
        return { ok: false, code };
    }
  } catch {
    // Reads fail closed without logging private reply text or names.
  }
  return { ok: false, code: 'UNAVAILABLE' };
}
export async function readArtistReplyActivityPage(
  input: ArtistReplyActivityPageInput,
  signal?: AbortSignal,
): Promise<ArtistReplyActivityResult<ArtistReplyActivityPage>> {
  const parsed = artistReplyActivityPageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const { slug, ...body } = parsed.data;
  const result = await request(
    artistReplyActivityApiPath(slug),
    body,
    artistReplyActivityPageSchema,
    signal,
  );
  if (
    result.ok &&
    (result.data.artist.slug !== slug ||
      (body.messageId === null
        ? result.data.selectedMessage !== null
        : result.data.selectedMessage?.id !== body.messageId) ||
      (body.messageId !== null &&
        result.data.replies.some((row) => row.messageId !== body.messageId)) ||
      new Set(result.data.replies.map((row) => row.id)).size !==
        result.data.replies.length ||
      result.data.hasMore !== (result.data.nextCursor !== null) ||
      (result.data.hasMore && result.data.replies.length === 0) ||
      (body.cursor !== undefined && result.data.nextCursor === body.cursor))
  )
    return { ok: false, code: 'UNAVAILABLE' };
  return result;
}
export async function readArtistReplyActivityMessages(
  input: ArtistReplyActivityMessagesInput,
  signal?: AbortSignal,
): Promise<ArtistReplyActivityResult<ArtistReplyActivityMessages>> {
  const parsed = artistReplyActivityMessagesInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const { slug, ...body } = parsed.data;
  const result = await request(
    artistReplyActivityApiPath(slug, 'messages'),
    body,
    artistReplyActivityMessagesSchema,
    signal,
  );
  if (
    result.ok &&
    (result.data.artist.slug !== slug ||
      new Set(result.data.messages.map((row) => row.id)).size !==
        result.data.messages.length ||
      result.data.hasMore !== (result.data.nextCursor !== null) ||
      (result.data.hasMore && result.data.messages.length === 0) ||
      (body.cursor !== undefined && result.data.nextCursor === body.cursor))
  )
    return { ok: false, code: 'UNAVAILABLE' };
  return result;
}
