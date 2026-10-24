import { z } from 'zod';
import {
  COMPOSE_ERROR_STATUS,
  COMPOSE_HTTP_OK,
  COMPOSE_REQUEST_TIMEOUT_MS,
  COMPOSE_RESPONSE_MAX_BYTES,
  composeDraftSchema,
  composePageInputSchema,
  composePageSchema,
  composePreviewInputSchema,
  composePreviewSchema,
  composeRemoveSchema,
  composeSaveSchema,
  type ComposeDraft,
  type ComposeError,
  type ComposePageData,
  type ComposePageInput,
  type ComposePreview,
  type ComposePreviewInput,
  type ComposeRemoveInput,
  type ComposeResult,
  type ComposeSaveInput,
} from '@/config/artist-compose';
import { artistComposeApiPath } from '@/config/routes';

async function request<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<ComposeResult<T>> {
  if (signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
  try {
    const timeout = AbortSignal.timeout(COMPOSE_REQUEST_TIMEOUT_MS);
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
        if (size > COMPOSE_RESPONSE_MAX_BYTES) {
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
      return response.status === COMPOSE_HTTP_OK
        ? parsed.data
        : { ok: false, code: 'UNAVAILABLE' };
    if (Object.hasOwn(COMPOSE_ERROR_STATUS, parsed.data.code)) {
      const code = parsed.data.code as ComposeError;
      if (response.status === COMPOSE_ERROR_STATUS[code])
        return { ok: false, code };
    }
  } catch {
    // A write can commit without its response. The owner retains the immutable
    // operation and never retries automatically or logs private draft data.
  }
  return { ok: false, code: 'UNAVAILABLE' };
}
export async function readComposePage(
  input: ComposePageInput,
  signal?: AbortSignal,
): Promise<ComposeResult<ComposePageData>> {
  const parsed = composePageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const { slug, ...body } = parsed.data;
  const result = await request(
    artistComposeApiPath(slug),
    body,
    composePageSchema,
    signal,
  );
  if (
    result.ok &&
    (result.data.artist.slug !== slug ||
      (body.messageId !== null &&
        result.data.selectedDraft?.id !== body.messageId) ||
      (body.messageId === null && result.data.selectedDraft !== null) ||
      new Set(result.data.drafts.map((draft) => draft.id)).size !==
        result.data.drafts.length ||
      result.data.hasMore !== (result.data.nextCursor !== null) ||
      (body.cursor !== undefined && result.data.nextCursor === body.cursor))
  )
    return { ok: false, code: 'UNAVAILABLE' };
  return result;
}
export async function saveComposeDraft(
  input: ComposeSaveInput,
  signal?: AbortSignal,
): Promise<ComposeResult<ComposeDraft>> {
  const parsed = composeSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const { slug, ...body } = parsed.data;
  const result = await request(
    artistComposeApiPath(slug, 'save'),
    body,
    composeDraftSchema,
    signal,
  );
  if (
    result.ok &&
    (result.data.id !== body.messageId ||
      result.data.kind !== body.kind ||
      result.data.body !== body.body ||
      result.data.revision !== body.expectedRevision + 1)
  )
    return { ok: false, code: 'UNAVAILABLE' };
  return result;
}
export async function removeComposeMedia(
  input: ComposeRemoveInput,
  signal?: AbortSignal,
): Promise<ComposeResult<ComposeDraft>> {
  const parsed = composeRemoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const { slug, ...body } = parsed.data;
  const result = await request(
    artistComposeApiPath(slug, 'remove'),
    body,
    composeDraftSchema,
    signal,
  );
  if (
    result.ok &&
    (result.data.id !== body.messageId ||
      result.data.revision !== body.expectedRevision + 1 ||
      result.data.media.some((item) => item.id === body.mediaId))
  )
    return { ok: false, code: 'UNAVAILABLE' };
  return result;
}
export async function previewComposeDraft(
  input: ComposePreviewInput,
  signal?: AbortSignal,
): Promise<ComposeResult<ComposePreview>> {
  const parsed = composePreviewInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const { slug, ...body } = parsed.data;
  const result = await request(
    artistComposeApiPath(slug, 'preview'),
    body,
    composePreviewSchema,
    signal,
  );
  return result.ok && result.data.sampleName !== body.sampleName
    ? { ok: false, code: 'UNAVAILABLE' }
    : result;
}
