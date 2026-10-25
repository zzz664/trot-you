import { z } from 'zod';
import {
  BILLING_NOTICE_ERROR_STATUS,
  BILLING_NOTICE_HTTP_OK,
  BILLING_NOTICE_REQUEST_TIMEOUT_MS,
  BILLING_NOTICE_RESPONSE_MAX_BYTES,
  billingNoticeCursorSchema,
  billingNoticeListSchema,
  billingNoticeReadSchema,
  billingNoticePreferenceSchema,
  type BillingNoticeError,
  type BillingNoticeList,
  type BillingNoticeResult,
} from '@/config/billing-notices';
import { routes } from '@/config/routes';

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  signal?: AbortSignal,
): Promise<BillingNoticeResult<T>> {
  if (signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
  try {
    const timeout = AbortSignal.timeout(BILLING_NOTICE_REQUEST_TIMEOUT_MS);
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined
        ? {}
        : {
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
        if (bytes > BILLING_NOTICE_RESPONSE_MAX_BYTES) {
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
      return response.status === BILLING_NOTICE_HTTP_OK
        ? parsed.data
        : { ok: false, code: 'UNAVAILABLE' };
    if (Object.hasOwn(BILLING_NOTICE_ERROR_STATUS, parsed.data.code)) {
      const code = parsed.data.code as BillingNoticeError;
      if (response.status === BILLING_NOTICE_ERROR_STATUS[code])
        return { ok: false, code };
    }
  } catch {
    // Financial previews, identifiers and session data are never logged.
  }
  return { ok: false, code: 'UNAVAILABLE' };
}

export async function fetchBillingNotices(
  cursor?: string,
  signal?: AbortSignal,
): Promise<BillingNoticeResult<BillingNoticeList>> {
  if (
    cursor !== undefined &&
    !billingNoticeCursorSchema.safeParse(cursor).success
  )
    return { ok: false, code: 'INVALID_INPUT' };
  const result = await request(
    cursor
      ? `${routes.billingNoticeStatus}?${new URLSearchParams({ cursor })}`
      : routes.billingNoticeStatus,
    billingNoticeListSchema,
    undefined,
    signal,
  );
  if (
    result.ok &&
    (new Set(result.data.notices.map((notice) => notice.id)).size !==
      result.data.notices.length ||
      result.data.hasMore !== (result.data.nextCursor !== null) ||
      (result.data.hasMore && result.data.notices.length === 0) ||
      (cursor !== undefined && result.data.nextCursor === cursor))
  )
    return { ok: false, code: 'UNAVAILABLE' };
  return result;
}

export async function markBillingNoticeRead(
  noticeId: string,
  signal?: AbortSignal,
): Promise<BillingNoticeResult<null>> {
  if (!z.uuid().safeParse(noticeId).success)
    return { ok: false, code: 'INVALID_INPUT' };
  return request(
    routes.billingNoticeRead,
    billingNoticeReadSchema,
    { noticeId },
    signal,
  );
}

export async function setBillingNoticePreference(
  enabled: boolean,
  signal?: AbortSignal,
): Promise<BillingNoticeResult<{ billingEnabled: boolean }>> {
  if (typeof enabled !== 'boolean') return { ok: false, code: 'INVALID_INPUT' };
  const result = await request(
    routes.billingNoticePreference,
    billingNoticePreferenceSchema,
    { enabled },
    signal,
  );
  return result.ok && result.data.billingEnabled !== enabled
    ? { ok: false, code: 'UNAVAILABLE' }
    : result;
}
