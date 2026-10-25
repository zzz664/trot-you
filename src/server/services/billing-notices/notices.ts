import 'server-only';
import {
  BILLING_NOTICE,
  billingNoticeCursorSchema,
  billingNoticeListSchema,
  billingNoticePreferenceInputSchema,
  billingNoticeReadInputSchema,
  type BillingNotice,
  type BillingNoticeList,
  type BillingNoticeResult,
} from '@/config/billing-notices';

export type BillingNoticeCursor = { beforeCreatedAt: string; beforeId: string };
export type BillingNoticePort = {
  list(
    limit: number,
    cursor: BillingNoticeCursor | null,
  ): Promise<BillingNoticeResult<BillingNotice[]>>;
  preferences(): Promise<BillingNoticeResult<{ billingEnabled: boolean }>>;
  setPreference(
    enabled: boolean,
  ): Promise<BillingNoticeResult<{ billingEnabled: boolean }>>;
  markRead(id: string): Promise<BillingNoticeResult<null>>;
};
export function parseBillingNoticeCursor(
  input?: unknown,
): BillingNoticeResult<BillingNoticeCursor | null> {
  if (input === undefined || input === null) return { ok: true, data: null };
  const parsed = billingNoticeCursorSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const [beforeCreatedAt, beforeId] = parsed.data.split('|');
  return {
    ok: true,
    data: { beforeCreatedAt: beforeCreatedAt!, beforeId: beforeId! },
  };
}
export async function listBillingNotices(
  port: BillingNoticePort,
  input?: unknown,
): Promise<BillingNoticeResult<BillingNoticeList>> {
  const cursor = parseBillingNoticeCursor(input);
  if (!cursor.ok) return cursor;
  try {
    const preference = await port.preferences();
    if (!preference.ok) return preference;
    const result = await port.list(BILLING_NOTICE.pageSize + 1, cursor.data);
    if (!result.ok) return result;
    if (
      result.data.length > BILLING_NOTICE.pageSize + 1 ||
      new Set(result.data.map((notice) => notice.id)).size !==
        result.data.length
    )
      return { ok: false, code: 'UNAVAILABLE' };
    const hasMore = result.data.length > BILLING_NOTICE.pageSize;
    const notices = result.data.slice(0, BILLING_NOTICE.pageSize);
    const last = notices.at(-1);
    const parsed = billingNoticeListSchema.safeParse({
      notices,
      hasMore,
      nextCursor: hasMore && last ? `${last.createdAt}|${last.id}` : null,
      billingEnabled: preference.data.billingEnabled,
    });
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function markBillingNoticeRead(
  port: BillingNoticePort,
  input: unknown,
): Promise<BillingNoticeResult<null>> {
  const parsed = billingNoticeReadInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    return await port.markRead(parsed.data.noticeId);
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function setBillingNoticePreference(
  port: BillingNoticePort,
  input: unknown,
): Promise<BillingNoticeResult<{ billingEnabled: boolean }>> {
  const parsed = billingNoticePreferenceInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    return await port.setPreference(parsed.data.enabled);
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
