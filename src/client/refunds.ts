import {
  adminRefundDetailSchema,
  refundActionInputSchema,
  refundAuthorizeInputSchema,
  refundRejectInputSchema,
  type AdminRefundDetail,
  type ManagementResult,
  type RefundActionInput,
  type RefundAuthorizeInput,
  type RefundRejectInput,
} from '@/config/subscription-management';
import { routes } from '@/config/routes';
import { managementRequest } from './management';

function matching(
  requestId: string,
  result: ManagementResult<AdminRefundDetail>,
): ManagementResult<AdminRefundDetail> {
  return result.ok && result.data.request.id !== requestId
    ? { ok: false, code: 'UNAVAILABLE' }
    : result;
}

export async function readAdminRefund(
  input: RefundActionInput,
): Promise<ManagementResult<AdminRefundDetail>> {
  const parsed = refundActionInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  return matching(
    parsed.data.requestId,
    await managementRequest(
      `${routes.adminRefundStatus}?request=${encodeURIComponent(parsed.data.requestId)}`,
      adminRefundDetailSchema,
    ),
  );
}

export async function authorizeRefund(
  input: RefundAuthorizeInput,
): Promise<ManagementResult<AdminRefundDetail>> {
  const parsed = refundAuthorizeInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const result = matching(
    parsed.data.requestId,
    await managementRequest(
      routes.refundAuthorize,
      adminRefundDetailSchema,
      parsed.data,
    ),
  );
  if (
    result.ok &&
    (result.data.request.amount_krw !== parsed.data.amountKrw ||
      result.data.request.policy_version !== parsed.data.policyVersion ||
      !['authorized', 'inflight', 'unknown', 'succeeded'].includes(
        result.data.request.status,
      ))
  )
    return { ok: false, code: 'UNAVAILABLE' };
  return result;
}

export async function rejectRefund(
  input: RefundRejectInput,
): Promise<ManagementResult<AdminRefundDetail>> {
  const parsed = refundRejectInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const result = matching(
    parsed.data.requestId,
    await managementRequest(
      routes.refundReject,
      adminRefundDetailSchema,
      parsed.data,
    ),
  );
  return result.ok && result.data.request.status !== 'rejected'
    ? { ok: false, code: 'UNAVAILABLE' }
    : result;
}

async function dispatch(
  path: string,
  input: RefundActionInput,
): Promise<ManagementResult<AdminRefundDetail>> {
  const parsed = refundActionInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  return matching(
    parsed.data.requestId,
    await managementRequest(path, adminRefundDetailSchema, parsed.data),
  );
}

export const executeRefund = (input: RefundActionInput) =>
  dispatch(routes.refundExecute, input);
export const reconcileRefund = (input: RefundActionInput) =>
  dispatch(routes.refundReconcile, input);
