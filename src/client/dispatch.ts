import { z } from 'zod';
import {
  DISPATCH_ERROR_STATUS,
  DISPATCH_HTTP_OK,
  DISPATCH_REQUEST_TIMEOUT_MS,
  DISPATCH_RESPONSE_MAX_BYTES,
  dispatchMessageSchema,
  dispatchPageInputSchema,
  dispatchPageSchema,
  dispatchSubmitSchema,
  dispatchCancelSchema,
  type DispatchMessage,
  type DispatchError,
  type DispatchPageData,
  type DispatchPageInput,
  type DispatchSubmitInput,
  type DispatchCancelInput,
  type DispatchResult,
} from '@/config/message-dispatch';
import { artistDispatchApiPath } from '@/config/routes';

async function request<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<DispatchResult<T>> {
  if (signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
  try {
    const timeout = AbortSignal.timeout(DISPATCH_REQUEST_TIMEOUT_MS);
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
        if (size > DISPATCH_RESPONSE_MAX_BYTES) {
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
      return response.status === DISPATCH_HTTP_OK
        ? parsed.data
        : { ok: false, code: 'UNAVAILABLE' };
    if (Object.hasOwn(DISPATCH_ERROR_STATUS, parsed.data.code)) {
      const code = parsed.data.code as DispatchError;
      if (response.status === DISPATCH_ERROR_STATUS[code])
        return { ok: false, code };
    }
  } catch {
    // A write can commit without its response. The owner retains the immutable
    // operation and never retries automatically or logs private message data.
  }
  return { ok: false, code: 'UNAVAILABLE' };
}
export async function readDispatchPage(
  input: DispatchPageInput,
  signal?: AbortSignal,
): Promise<DispatchResult<DispatchPageData>> {
  const parsed = dispatchPageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const { slug, ...body } = parsed.data;
  const result = await request(
    artistDispatchApiPath(slug),
    body,
    dispatchPageSchema,
    signal,
  );
  if (
    result.ok &&
    (result.data.artist.slug !== slug ||
      (body.messageId === null
        ? result.data.selectedMessage !== null
        : result.data.selectedMessage?.id !== body.messageId) ||
      new Set(result.data.messages.map((message) => message.id)).size !==
        result.data.messages.length ||
      result.data.hasMore !== (result.data.nextCursor !== null) ||
      (body.cursor !== undefined && result.data.nextCursor === body.cursor))
  )
    return { ok: false, code: 'UNAVAILABLE' };
  return result;
}
export async function submitDispatch(
  input: DispatchSubmitInput,
  signal?: AbortSignal,
): Promise<DispatchResult<DispatchMessage>> {
  const parsed = dispatchSubmitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const { slug, ...body } = parsed.data;
  const result = await request(
    artistDispatchApiPath(slug, 'submit'),
    body,
    dispatchMessageSchema,
    signal,
  );
  // Exact replays intentionally return current state, which may be canceled.
  // Never demand a stale status or manufacture a second submission.
  if (
    result.ok &&
    (result.data.id !== body.messageId ||
      (body.scheduledAt !== null &&
        Date.parse(result.data.scheduledAt) !== Date.parse(body.scheduledAt)))
  )
    return { ok: false, code: 'UNAVAILABLE' };
  return result;
}
export async function cancelDispatch(
  input: DispatchCancelInput,
  signal?: AbortSignal,
): Promise<DispatchResult<DispatchMessage>> {
  const parsed = dispatchCancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const { slug, ...body } = parsed.data;
  const result = await request(
    artistDispatchApiPath(slug, 'cancel'),
    body,
    dispatchMessageSchema,
    signal,
  );
  return result.ok &&
    (result.data.id !== body.messageId || result.data.status !== 'canceled')
    ? { ok: false, code: 'UNAVAILABLE' }
    : result;
}
