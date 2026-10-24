import 'server-only';
import {
  managementPageSchema,
  subscriptionInputSchema,
  refundRequestInputSchema,
  refundAuthorizeInputSchema,
  refundRejectInputSchema,
  refundActionInputSchema,
  type AdminRefundDetail,
  type AdminRefundRecord,
  type ManagementResult,
  type SubscriptionDetail,
} from '@/config/subscription-management';
import type { ManagementDbPort } from './management-model';

const unavailable = { ok: false, code: 'UNAVAILABLE' } as const;
const invalid = { ok: false, code: 'INVALID_INPUT' } as const;
export function adminRefundDetail(
  row: AdminRefundRecord,
  executionEnabled: boolean,
): AdminRefundDetail {
  const { request, policy } = row;
  return {
    ...row,
    execution_enabled: executionEnabled,
    can_authorize: request.status === 'requested' && policy !== null,
    can_reject:
      request.status === 'requested' || request.status === 'authorized',
    can_execute:
      executionEnabled &&
      request.status === 'authorized' &&
      !request.requires_manual_review &&
      policy !== null &&
      request.policy_version === policy.version,
    can_reconcile: request.can_reconcile,
  };
}
export async function listSubscriptions(
  db: ManagementDbPort,
  page: unknown = 1,
) {
  const parsed = managementPageSchema.safeParse(page);
  if (!parsed.success) return invalid;
  try {
    const result = await db.list(parsed.data);
    return result.ok && result.data.page !== parsed.data ? unavailable : result;
  } catch {
    return unavailable;
  }
}
export async function readSubscription(
  db: ManagementDbPort,
  input: unknown,
  page: unknown = 1,
): Promise<ManagementResult<SubscriptionDetail>> {
  const parsed = subscriptionInputSchema.safeParse(input);
  const paging = managementPageSchema.safeParse(page);
  if (!parsed.success || !paging.success) return invalid;
  try {
    const result = await db.read(parsed.data.subscriptionId, paging.data);
    return result.ok &&
      (result.data.id !== parsed.data.subscriptionId ||
        result.data.page !== paging.data)
      ? unavailable
      : result;
  } catch {
    return unavailable;
  }
}
export async function cancelSubscription(
  db: ManagementDbPort,
  input: unknown,
): Promise<ManagementResult<SubscriptionDetail>> {
  const parsed = subscriptionInputSchema.safeParse(input);
  if (!parsed.success) return invalid;
  try {
    const changed = await db.cancel(parsed.data.subscriptionId);
    if (!changed.ok && changed.code !== 'UNAVAILABLE') return changed;
    const observed = await readSubscription(db, parsed.data);
    // A lost mutation reply is resolved only from the durable terminal intent,
    // not from a successful HTTP transport or a preserved paid-access flag.
    return observed.ok && ['canceled', 'expired'].includes(observed.data.status)
      ? observed
      : changed.ok
        ? unavailable
        : changed;
  } catch {
    return unavailable;
  }
}
export async function requestRefund(
  db: ManagementDbPort,
  input: unknown,
): Promise<ManagementResult<SubscriptionDetail>> {
  const parsed = refundRequestInputSchema.safeParse(input);
  if (!parsed.success) return invalid;
  try {
    const result = await db.request(parsed.data);
    if (!result.ok) return result;
    if (
      result.data.subscription_id !== parsed.data.subscriptionId ||
      result.data.original_event_id !== parsed.data.originalEventId ||
      result.data.amount_krw !== parsed.data.amountKrw ||
      result.data.reason !== parsed.data.reason
    )
      return unavailable;
    return readSubscription(db, { subscriptionId: parsed.data.subscriptionId });
  } catch {
    return unavailable;
  }
}
export async function listAdminRefunds(
  db: ManagementDbPort,
  page: unknown = 1,
) {
  const parsed = managementPageSchema.safeParse(page);
  if (!parsed.success) return invalid;
  try {
    const result = await db.adminList(parsed.data);
    return result.ok && result.data.page !== parsed.data ? unavailable : result;
  } catch {
    return unavailable;
  }
}
export async function readAdminRefund(
  db: ManagementDbPort,
  input: unknown,
  executionEnabled: boolean,
): Promise<ManagementResult<AdminRefundDetail>> {
  const parsed = refundActionInputSchema.safeParse(input);
  if (!parsed.success) return invalid;
  try {
    const result = await db.adminRead(parsed.data.requestId);
    if (!result.ok) return result;
    return result.data.request.id === parsed.data.requestId
      ? { ok: true, data: adminRefundDetail(result.data, executionEnabled) }
      : unavailable;
  } catch {
    return unavailable;
  }
}
export async function authorizeRefund(
  db: ManagementDbPort,
  input: unknown,
  executionEnabled: boolean,
): Promise<ManagementResult<AdminRefundDetail>> {
  const parsed = refundAuthorizeInputSchema.safeParse(input);
  if (!parsed.success) return invalid;
  try {
    const result = await db.authorize(parsed.data);
    if (!result.ok) return result;
    if (
      result.data.id !== parsed.data.requestId ||
      result.data.status !== 'authorized' ||
      result.data.amount_krw !== parsed.data.amountKrw ||
      result.data.policy_version !== parsed.data.policyVersion
    )
      return unavailable;
    return readAdminRefund(
      db,
      { requestId: parsed.data.requestId },
      executionEnabled,
    );
  } catch {
    return unavailable;
  }
}
export async function rejectRefund(
  db: ManagementDbPort,
  input: unknown,
  executionEnabled: boolean,
): Promise<ManagementResult<AdminRefundDetail>> {
  const parsed = refundRejectInputSchema.safeParse(input);
  if (!parsed.success) return invalid;
  try {
    const result = await db.reject(parsed.data);
    if (!result.ok) return result;
    if (
      result.data.id !== parsed.data.requestId ||
      result.data.status !== 'rejected'
    )
      return unavailable;
    return readAdminRefund(
      db,
      { requestId: parsed.data.requestId },
      executionEnabled,
    );
  } catch {
    return unavailable;
  }
}
