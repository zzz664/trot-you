import 'server-only';
import { z } from 'zod';
import {
  ANALYTICS_FUNNEL,
  analyticsFunnelDashboardSchema,
  analyticsFunnelQuerySchema,
  type AnalyticsFunnelDashboard,
  type AnalyticsFunnelQuery,
  type AnalyticsFunnelResult,
} from '@/config/analytics-funnel';
export type AnalyticsFunnelPort = {
  read(
    query: AnalyticsFunnelQuery,
  ): Promise<AnalyticsFunnelResult<AnalyticsFunnelDashboard>>;
};
const parameters = z.strictObject({
  from: z.string().optional(),
  to: z.string().optional(),
});
export function resolveAnalyticsFunnelQuery(
  input: unknown,
  now = new Date(),
): AnalyticsFunnelResult<AnalyticsFunnelQuery> {
  const parsed = parameters.safeParse(input);
  if (!parsed.success || !Number.isFinite(now.getTime()))
    return { ok: false, code: 'INVALID_INPUT' };
  const raw = parsed.data;
  if ((raw.from === undefined) !== (raw.to === undefined))
    return { ok: false, code: 'INVALID_INPUT' };
  const today = new Date(now.getTime() + ANALYTICS_FUNNEL.kstOffsetMs)
    .toISOString()
    .slice(0, ANALYTICS_FUNNEL.dateLength);
  const from = new Date(
    Date.parse(today) -
      (ANALYTICS_FUNNEL.defaultDays - 1) * ANALYTICS_FUNNEL.dayMs,
  )
    .toISOString()
    .slice(0, ANALYTICS_FUNNEL.dateLength);
  const query = analyticsFunnelQuerySchema.safeParse({
    from: raw.from ?? from,
    to: raw.to ?? today,
  });
  return query.success && query.data.to <= today
    ? { ok: true, data: query.data }
    : { ok: false, code: 'INVALID_INPUT' };
}
export async function getAnalyticsFunnelDashboard(
  port: AnalyticsFunnelPort,
  input: unknown,
  actorId: string,
): Promise<AnalyticsFunnelResult<AnalyticsFunnelDashboard>> {
  const query = analyticsFunnelQuerySchema.safeParse(input);
  const actor = z.uuid().toLowerCase().safeParse(actorId);
  if (!query.success || !actor.success)
    return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.read(query.data);
    if (!result.ok) return result;
    const data = analyticsFunnelDashboardSchema.safeParse(result.data);
    return data.success &&
      data.data.actor_id === actor.data &&
      data.data.from === query.data.from &&
      data.data.to === query.data.to
      ? { ok: true, data: data.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
