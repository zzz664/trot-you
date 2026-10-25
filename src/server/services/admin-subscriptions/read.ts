import 'server-only';
import { z } from 'zod';
import {
  ADMIN_SUBSCRIPTIONS,
  adminSubscriptionQuerySchema,
  type AdminSubscriptionDashboard,
  type AdminSubscriptionQuery,
  type AdminSubscriptionResult,
} from '@/config/admin-subscriptions';
export type AdminSubscriptionPort = {
  read(
    query: AdminSubscriptionQuery,
  ): Promise<AdminSubscriptionResult<AdminSubscriptionDashboard>>;
};
const parameters = z.strictObject({
  from: z.string().optional(),
  to: z.string().optional(),
  artist_id: z.string().optional(),
  page: z
    .string()
    .regex(/^[1-9]\d{0,3}$/)
    .optional(),
});
export function resolveAdminSubscriptionQuery(
  input: unknown,
  now = new Date(),
): AdminSubscriptionResult<AdminSubscriptionQuery> {
  const parsed = parameters.safeParse(input);
  if (!parsed.success || !Number.isFinite(now.getTime()))
    return { ok: false, code: 'INVALID_INPUT' };
  const raw = parsed.data;
  if ((raw.from === undefined) !== (raw.to === undefined))
    return { ok: false, code: 'INVALID_INPUT' };
  const today = new Date(now.getTime() + ADMIN_SUBSCRIPTIONS.kstOffsetMs)
    .toISOString()
    .slice(0, ADMIN_SUBSCRIPTIONS.dateLength);
  const start = new Date(
    Date.parse(today) -
      (ADMIN_SUBSCRIPTIONS.defaultDays - 1) * ADMIN_SUBSCRIPTIONS.dayMs,
  )
    .toISOString()
    .slice(0, ADMIN_SUBSCRIPTIONS.dateLength);
  const result = adminSubscriptionQuerySchema.safeParse({
    from: raw.from ?? start,
    to: raw.to ?? today,
    artist_id: raw.artist_id ?? null,
    page: raw.page === undefined ? 1 : Number(raw.page),
  });
  return result.success && result.data.to <= today
    ? { ok: true, data: result.data }
    : { ok: false, code: 'INVALID_INPUT' };
}
export async function getAdminSubscriptionDashboard(
  port: AdminSubscriptionPort,
  input: unknown,
): Promise<AdminSubscriptionResult<AdminSubscriptionDashboard>> {
  const parsed = adminSubscriptionQuerySchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    return await port.read(parsed.data);
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
