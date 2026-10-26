import { z } from 'zod';
import {
  ANALYTICS_FUNNEL,
  ANALYTICS_FUNNEL_ERROR_STATUS,
  analyticsFunnelDashboardSchema,
  analyticsFunnelQuerySchema,
  type AnalyticsFunnelDashboard,
  type AnalyticsFunnelError,
  type AnalyticsFunnelQuery,
  type AnalyticsFunnelResult,
} from '@/config/analytics-funnel';
import { analyticsFunnelPath } from '@/config/routes';
export async function fetchAnalyticsFunnelDashboard(
  query: AnalyticsFunnelQuery,
  signal?: AbortSignal,
  actorKey?: string,
): Promise<AnalyticsFunnelResult<AnalyticsFunnelDashboard>> {
  const input = analyticsFunnelQuerySchema.safeParse(query);
  if (!input.success) return { ok: false, code: 'INVALID_INPUT' };
  const actor = z.uuid().toLowerCase().safeParse(actorKey);
  if (!actor.success) return { ok: false, code: 'FORBIDDEN' };
  if (signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
  try {
    const timeout = AbortSignal.timeout(ANALYTICS_FUNNEL.requestTimeoutMs);
    const response = await fetch(analyticsFunnelPath(input.data, true), {
      method: 'GET',
      headers: { [ANALYTICS_FUNNEL.actorHeader]: actor.data },
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
        if (bytes > ANALYTICS_FUNNEL.responseMaxBytes) {
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
        z.strictObject({
          ok: z.literal(true),
          data: analyticsFunnelDashboardSchema,
        }),
        z.strictObject({ ok: z.literal(false), code: z.string() }),
      ])
      .safeParse(JSON.parse(text));
    if (!result.success || signal?.aborted || timeout.aborted)
      return { ok: false, code: 'UNAVAILABLE' };
    if (result.data.ok)
      return response.status === ANALYTICS_FUNNEL.httpOk &&
        result.data.data.actor_id === actor.data &&
        result.data.data.from === input.data.from &&
        result.data.data.to === input.data.to
        ? result.data
        : { ok: false, code: 'UNAVAILABLE' };
    if (Object.hasOwn(ANALYTICS_FUNNEL_ERROR_STATUS, result.data.code)) {
      const code = result.data.code as AnalyticsFunnelError;
      if (response.status === ANALYTICS_FUNNEL_ERROR_STATUS[code])
        return { ok: false, code };
    }
  } catch {
    /* Never log identity, private aggregate or SQL/auth details. */
  }
  return { ok: false, code: 'UNAVAILABLE' };
}
