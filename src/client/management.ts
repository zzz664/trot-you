import { z } from 'zod';
import {
  MANAGEMENT_ERROR_STATUS,
  MANAGEMENT_REQUEST_TIMEOUT_MS,
  MANAGEMENT_RESPONSE_MAX_BYTES,
  type ManagementError,
  type ManagementResult,
} from '@/config/subscription-management';

// Same-origin transport only. Callers supply central route constants and validate
// identities. There are no provider URLs, redirects, retries or raw error logs.
export async function managementRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  input?: unknown,
): Promise<ManagementResult<T>> {
  try {
    const response = await fetch(path, {
      method: input === undefined ? 'GET' : 'POST',
      ...(input !== undefined && {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(MANAGEMENT_REQUEST_TIMEOUT_MS),
    });
    if (
      response.headers.get('content-type')?.split(';')[0]?.trim() !==
      'application/json'
    )
      return { ok: false, code: 'UNAVAILABLE' };
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, code: 'UNAVAILABLE' };
    let text = '';
    let size = 0;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MANAGEMENT_RESPONSE_MAX_BYTES) {
          await reader.cancel();
          return { ok: false, code: 'UNAVAILABLE' };
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const result = z
      .union([
        z.strictObject({ ok: z.literal(true), data: schema }),
        z.strictObject({ ok: z.literal(false), code: z.string() }),
      ])
      .safeParse(JSON.parse(text));
    if (!result.success) return { ok: false, code: 'UNAVAILABLE' };
    if (result.data.ok)
      return response.ok ? result.data : { ok: false, code: 'UNAVAILABLE' };
    if (Object.hasOwn(MANAGEMENT_ERROR_STATUS, result.data.code))
      return { ok: false, code: result.data.code as ManagementError };
  } catch {
    // Response loss can follow a committed cancellation, approval or refund.
    // Never infer failure or replay a write automatically.
  }
  return { ok: false, code: 'UNAVAILABLE' };
}
