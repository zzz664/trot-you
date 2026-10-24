import type {
  AdminRefundDetail,
  RefundRequest,
  SubscriptionDetail,
} from '@/config/subscription-management';

export const managementIds = {
  subscription: 'ab160000-0000-4000-8000-000000000001',
  artist: 'ab160000-0000-4000-8000-000000000002',
  charge: 'ab160000-0000-4000-8000-000000000003',
  request: 'ab160000-0000-4000-8000-000000000004',
  policy: 'ab160000-0000-4000-8000-000000000005',
  key: 'ab160000-0000-4000-8000-000000000006',
  other: 'ab160000-0000-4000-8000-000000000007',
};
export const managementRequest: RefundRequest = {
  id: managementIds.request,
  subscription_id: managementIds.subscription,
  original_event_id: managementIds.charge,
  artist_name: '허구 가수',
  artist_slug: 'fictional-refund-star',
  amount_krw: 500,
  charge_amount_krw: 1000,
  refunded_krw: 0,
  currency: 'KRW',
  status: 'requested',
  reason: '허구 테스트 검토 사유',
  decision_reason: null,
  policy_version: null,
  requested_at: '2026-10-24T12:00:00Z',
  decided_at: null,
  finished_at: null,
  can_reconcile: false,
  requires_manual_review: false,
};
export const managementSubscription: SubscriptionDetail = {
  id: managementIds.subscription,
  artist_id: managementIds.artist,
  artist_name: managementRequest.artist_name,
  artist_slug: managementRequest.artist_slug,
  status: 'active',
  current_period_end: '2026-11-24T12:00:00Z',
  next_billing_at: '2026-11-24T12:00:00Z',
  canceled_at: null,
  has_unresolved_charge: false,
  has_access: true,
  can_cancel: true,
  charges: [
    {
      id: managementIds.charge,
      amount_krw: 1000,
      currency: 'KRW',
      occurred_at: '2026-10-24T12:00:00Z',
      refunded_krw: 0,
      refund_request: null,
      can_request_refund: true,
    },
  ],
  charges_more_available: false,
  page: 1,
};
export const managementAdmin: AdminRefundDetail = {
  request: managementRequest,
  policy: {
    version: managementIds.policy,
    title: '허구 승인 정책 · 테스트 전용',
    body: '테스트 전용 정책 본문이며 실제 환불 정책이나 법률 조언이 아닙니다.',
    access_effect: 'preserve_paid_access',
  },
  execution_enabled: true,
  can_authorize: true,
  can_reject: true,
  can_execute: false,
  can_reconcile: false,
};
export const managementCanceled: SubscriptionDetail = {
  ...managementSubscription,
  status: 'canceled',
  next_billing_at: null,
  canceled_at: '2026-10-24T12:30:00Z',
  can_cancel: false,
};
export const managementAuthorized: AdminRefundDetail = {
  ...managementAdmin,
  request: {
    ...managementRequest,
    status: 'authorized',
    policy_version: managementIds.policy,
    decision_reason: '허구 관리자 검토 사유',
    decided_at: '2026-10-24T12:30:00Z',
  },
  can_authorize: false,
  can_execute: true,
};
