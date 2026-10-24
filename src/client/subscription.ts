import {
  managementPageSchema,
  refundRequestInputSchema,
  subscriptionDetailSchema,
  subscriptionInputSchema,
  type ManagementResult,
  type RefundRequestInput,
  type SubscriptionDetail,
  type SubscriptionInput,
} from '@/config/subscription-management';
import { routes } from '@/config/routes';
import { managementRequest } from './management';

function matching(
  subscriptionId: string,
  result: ManagementResult<SubscriptionDetail>,
): ManagementResult<SubscriptionDetail> {
  return result.ok && result.data.id !== subscriptionId
    ? { ok: false, code: 'UNAVAILABLE' }
    : result;
}

export async function readSubscription(
  input: SubscriptionInput,
  page = 1,
): Promise<ManagementResult<SubscriptionDetail>> {
  const parsed = subscriptionInputSchema.safeParse(input);
  const validPage = managementPageSchema.safeParse(page);
  if (!parsed.success || !validPage.success)
    return { ok: false, code: 'INVALID_INPUT' };
  const query = new URLSearchParams({
    subscription: parsed.data.subscriptionId,
    page: String(validPage.data),
  });
  const result = matching(
    parsed.data.subscriptionId,
    await managementRequest(
      `${routes.subscriptionStatus}?${query}`,
      subscriptionDetailSchema,
    ),
  );
  return result.ok && result.data.page !== validPage.data
    ? { ok: false, code: 'UNAVAILABLE' }
    : result;
}

export async function cancelSubscription(
  input: SubscriptionInput,
): Promise<ManagementResult<SubscriptionDetail>> {
  const parsed = subscriptionInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const result = matching(
    parsed.data.subscriptionId,
    await managementRequest(
      routes.subscriptionCancel,
      subscriptionDetailSchema,
      parsed.data,
    ),
  );
  return result.ok && !['canceled', 'expired'].includes(result.data.status)
    ? { ok: false, code: 'UNAVAILABLE' }
    : result;
}

export async function requestRefund(
  input: RefundRequestInput,
): Promise<ManagementResult<SubscriptionDetail>> {
  const parsed = refundRequestInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  return matching(
    parsed.data.subscriptionId,
    await managementRequest(
      routes.refundRequest,
      subscriptionDetailSchema,
      parsed.data,
    ),
  );
}
