import { z } from 'zod';
import {
  ADMIN_SUBSCRIPTIONS,
  ADMIN_SUBSCRIPTION_ERROR_STATUS,
  adminSubscriptionDashboardSchema,
  adminSubscriptionQuerySchema,
  type AdminSubscriptionError,
  type AdminSubscriptionResult,
  type AdminSubscriptionQuery,
} from '@/config/admin-subscriptions';
import { adminSubscriptionPath } from '@/config/routes';

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<AdminSubscriptionResult<T>> {
  if (signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
  try {
    const timeout = AbortSignal.timeout(ADMIN_SUBSCRIPTIONS.requestTimeoutMs);
    const response = await fetch(path, {
      method: 'GET',
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
        if (bytes > ADMIN_SUBSCRIPTIONS.responseMaxBytes) {
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
      return response.status === ADMIN_SUBSCRIPTIONS.httpOk
        ? parsed.data
        : { ok: false, code: 'UNAVAILABLE' };
    if (Object.hasOwn(ADMIN_SUBSCRIPTION_ERROR_STATUS, parsed.data.code)) {
      const code = parsed.data.code as AdminSubscriptionError;
      if (response.status === ADMIN_SUBSCRIPTION_ERROR_STATUS[code])
        return { ok: false, code };
    }
  } catch {
    // Aggregates, identifiers and session data are never logged.
  }
  return { ok: false, code: 'UNAVAILABLE' };
}

export async function fetchAdminSubscriptionDashboard(
  query: AdminSubscriptionQuery,
  signal?: AbortSignal,
) {
  const parsed = adminSubscriptionQuerySchema.safeParse(query);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' } as const;
  const result = await request(
    adminSubscriptionPath(parsed.data, true),
    adminSubscriptionDashboardSchema,
    signal,
  );
  if (
    result.ok &&
    (result.data.from !== query.from ||
      result.data.to !== query.to ||
      result.data.page !== query.page ||
      (result.data.selected_artist?.id ?? null) !== query.artist_id)
  )
    return { ok: false, code: 'UNAVAILABLE' } as const;
  return result;
}
