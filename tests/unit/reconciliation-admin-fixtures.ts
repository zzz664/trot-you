import type { ReconciliationAdminList } from '@/config/reconciliation-admin';

export const reconciliationAdminIds = {
  case: '17171717-1717-4717-8717-171717171701',
  subscription: '17171717-1717-4717-8717-171717171702',
  admin: '17171717-1717-4717-8717-171717171703',
};
export const reconciliationAdminCase: ReconciliationAdminList['cases'][number] =
  {
    id: reconciliationAdminIds.case,
    kind: 'renewal',
    subscription_id: reconciliationAdminIds.subscription,
    provider: 'kakaopay',
    environment: 'test',
    amount_krw: 9900,
    status: 'manual_review',
    reason: 'PAYMENT_ID_MISSING',
    query_attempts: 0,
    created_at: '2026-10-24T12:00:00Z',
    updated_at: '2026-10-24T12:01:00Z',
  };
export const reconciliationAdminList: ReconciliationAdminList = {
  cases: [reconciliationAdminCase],
  page: 1,
  has_more: false,
};
