import type { PrivateEnrollment } from '@/server/services/enrollment/model';
export const id = (n: number) =>
  `b1700000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
export const actor = {
  actorId: id(1),
  nonceHash: 'a'.repeat(64),
  authSessionHash: 'b'.repeat(64),
};
const envelope = {
  version: 'unit',
  iv: 'a'.repeat(16),
  tag: 'a'.repeat(22),
  ciphertext: 'cGlp',
};
export function row(
  overrides: Partial<PrivateEnrollment> = {},
): PrivateEnrollment {
  return {
    session_id: id(2),
    user_id: actor.actorId,
    artist_id: id(3),
    artist_slug: 'fictional-star',
    artist_name: '허구 가수',
    provider: 'toss',
    environment: 'test',
    merchant_account: 'fictional_mid',
    subscription_id: id(4),
    mandate_id: id(5),
    credential_ref: id(6),
    customer_ref: id(7),
    order_id: id(8),
    policy_version: id(9),
    billing_period_calendar: 'utc_monthly_clamped',
    payment_tax_basis: 'taxable_krw',
    policy_title: '허구 약관',
    policy_body: '격리 단위 점검',
    initial_price_krw: 1000,
    regular_price_krw: 6500,
    intro_eligible: true,
    expires_at: '2026-10-24T12:15:00.000Z',
    state: 'awaiting_confirmation',
    stage: null,
    public_status: 'awaiting_confirmation',
    callback_ciphertext: envelope,
    callback_expires_at: '2026-10-24T12:05:00.000Z',
    credential_ciphertext: null,
    tid: null,
    redirects: null,
    payment_event_id: null,
    period_start: null,
    period_end: null,
    ...overrides,
  };
}
export const charge = {
  customerRef: id(7),
  orderId: id(8),
  amountKrw: 1000,
  providerPaymentId: 'fictional_payment',
  providerTransactionId: 'fictional_action',
  approvedAt: '2026-10-24T12:00:01.000Z',
  currency: 'KRW' as const,
  merchantAccount: 'fictional_mid',
};
