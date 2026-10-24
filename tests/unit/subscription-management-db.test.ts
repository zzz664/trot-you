// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ActorClient } from '@/server/db/client';
import type { CheckoutServiceClient } from '@/server/db/checkout-client';
import {
  createManagementDbPort,
  createRefundDbPort,
} from '@/server/db/subscription-management';
import {
  MANAGEMENT_ADMIN_LIMIT,
  MANAGEMENT_CHARGE_LIMIT,
  MANAGEMENT_LIST_LIMIT,
} from '@/config/subscription-management';
import type { RefundSnapshot } from '@/server/services/subscription/management-model';
import type { VerifiedRefund } from '@/server/adapters/payment/refund';
import {
  managementIds as ids,
  managementAdmin,
  managementRequest,
  managementSubscription,
} from './management-fixtures';
const unavailable = { ok: false, code: 'UNAVAILABLE' };
const requestInput = {
  subscriptionId: ids.subscription,
  originalEventId: ids.charge,
  amountKrw: managementRequest.amount_krw,
  reason: managementRequest.reason,
  idempotencyKey: ids.key,
};
const authorization = {
  requestId: ids.request,
  amountKrw: managementRequest.amount_krw,
  policyVersion: ids.policy,
  reason: 'fictional admin reason',
  accepted: true as const,
};
const snapshot: RefundSnapshot = {
  request_id: ids.request,
  subscription_id: ids.subscription,
  user_id: ids.other,
  original_event_id: ids.charge,
  state: 'authorized',
  amount_krw: 500,
  currency: 'KRW',
  provider: 'toss',
  environment: 'test',
  merchant_account: 'fictional-mid',
  customer_ref: ids.other,
  order_id: ids.key,
  provider_payment_id: 'fictional-payment',
  provider_charge_action_id: 'fictional-charge-action',
  charge_amount_krw: 1000,
  refunded_before_krw: 0,
  policy_version: ids.policy,
  payment_tax_basis: 'taxable_krw',
  requested_at: managementRequest.requested_at,
  authorized_at: '2026-10-24T12:30:00Z',
  action: 'refund',
  reason: null,
  dispatch: false,
  lease_token: null,
  payment_event_id: null,
};
const verified: VerifiedRefund = {
  attemptId: ids.request,
  orderId: ids.key,
  customerRef: ids.other,
  providerPaymentId: 'fictional-payment',
  originalProviderTransactionId: 'fictional-charge-action',
  originalAmountKrw: 1000,
  amountKrw: 500,
  refundedBeforeKrw: 0,
  currency: 'KRW',
  taxBasis: 'taxable_krw',
  providerTransactionId: 'fictional-refund-action',
  refundedAt: '2026-10-24T12:31:00Z',
  cumulativeRefundedKrw: 500,
  remainingKrw: 500,
  merchantAccount: 'fictional-mid',
};
function setup(data: unknown = null, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  const from = vi.fn(() => {
    throw new Error('Direct SQL forbidden');
  });
  return {
    rpc,
    from,
    actor: createManagementDbPort({ rpc, from } as unknown as ActorClient),
    service: createRefundDbPort({
      rpc,
      from,
    } as unknown as CheckoutServiceClient),
  };
}
describe('actor subscription management DB boundary', () => {
  it('lists only using the actor-token RPC and bounded paging; no caller actor ID or service query', async () => {
    const data = {
      subscriptions: [managementSubscription],
      page: 2,
      more_available: true,
    };
    const { actor, rpc, from } = setup(data);
    expect(await actor.list(2)).toMatchObject({
      ok: true,
      data: { page: 2, more_available: true },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'subscription_management_list',
      { p_page: 2 },
    );
    expect(from).not.toHaveBeenCalled();
  });
  it('reads ownership-filtered detail using exact subscription/page', async () => {
    const { actor, rpc } = setup(managementSubscription);
    expect(await actor.read(ids.subscription, 1)).toEqual({
      ok: true,
      data: managementSubscription,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'subscription_management_read',
      { p_subscription_id: ids.subscription, p_page: 1 },
    );
  });
  it('cancels only via state-transition RPC and discards raw/private response', async () => {
    const { actor, rpc } = setup({ credential: 'private-provider-key' });
    expect(await actor.cancel(ids.subscription)).toEqual({
      ok: true,
      data: null,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('cancel_subscription', {
      p_subscription_id: ids.subscription,
    });
  });
  it('binds owner request identity and amount without provider fields', async () => {
    const { actor, rpc } = setup(managementRequest);
    expect(await actor.request(requestInput)).toEqual({
      ok: true,
      data: managementRequest,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('refund_request', {
      p_subscription_id: ids.subscription,
      p_original_event_id: ids.charge,
      p_amount_krw: 500,
      p_reason: requestInput.reason,
      p_idempotency_key: ids.key,
    });
  });
  it('uses bounded admin list RPC and exact request reader', async () => {
    const list = {
      requests: [managementRequest],
      policy: managementAdmin.policy,
      page: 1,
      more_available: false,
    };
    const { actor, rpc } = setup(list);
    expect(await actor.adminList(1)).toEqual({ ok: true, data: list });
    expect(rpc).toHaveBeenCalledWith('refund_admin_list', {
      p_limit: MANAGEMENT_ADMIN_LIMIT,
      p_page: 1,
    });
    const detail = {
      request: managementRequest,
      policy: managementAdmin.policy,
    };
    rpc.mockResolvedValue({ data: detail, error: null });
    expect(await actor.adminRead(ids.request)).toEqual({
      ok: true,
      data: detail,
    });
    expect(rpc).toHaveBeenLastCalledWith('refund_admin_read', {
      p_request_id: ids.request,
    });
  });
  it('passes explicit approval amount/policy and rejection reason, never caller actor ID', async () => {
    const { actor, rpc } = setup(managementRequest);
    await actor.authorize(authorization);
    expect(rpc).toHaveBeenLastCalledWith('refund_decide', {
      p_request_id: ids.request,
      p_decision: 'approve',
      p_amount_krw: 500,
      p_policy_version: ids.policy,
      p_reason: authorization.reason,
    });
    await actor.reject({
      requestId: ids.request,
      reason: authorization.reason,
    });
    expect(rpc).toHaveBeenLastCalledWith('refund_decide', {
      p_request_id: ids.request,
      p_decision: 'reject',
      p_reason: authorization.reason,
    });
  });
  it('strips unexpected private fields at every public projection layer', async () => {
    const detail = {
      ...managementSubscription,
      provider_payment_id: 'secret-payment',
      charges: managementSubscription.charges.map((charge) => ({
        ...charge,
        provider_customer_ref: 'secret-customer',
        refund_request: {
          ...managementRequest,
          authorized_by: 'private-admin-id',
          private_token: 'private-token',
        },
      })),
    };
    const result = await setup(detail).actor.read(ids.subscription, 1);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/secret-|private-/);
    const admin = await setup({
      ...managementAdmin,
      private_identity: 'private',
      request: { ...managementRequest, authorized_by: 'private' },
      policy: { ...managementAdmin.policy, private_approval: 'private' },
    }).actor.adminRead(ids.request);
    expect(JSON.stringify(admin)).not.toContain('private');
  });
  it.each([
    null,
    {},
    { ...managementSubscription, id: 'bad' },
    { ...managementSubscription, current_period_end: 'bad' },
    {
      ...managementSubscription,
      charges: [{ ...managementSubscription.charges[0], refunded_krw: -1 }],
    },
    {
      ...managementSubscription,
      charges: Array.from(
        { length: MANAGEMENT_CHARGE_LIMIT + 1 },
        () => managementSubscription.charges[0],
      ),
    },
  ])('fails malformed detail %# closed', async (data) => {
    expect(await setup(data).actor.read(ids.subscription, 1)).toEqual(
      unavailable,
    );
  });
  it('enforces list count and safe public types, not arbitrary database JSON', async () => {
    expect(
      await setup({
        subscriptions: Array.from(
          { length: MANAGEMENT_LIST_LIMIT + 1 },
          () => managementSubscription,
        ),
        page: 1,
        more_available: false,
      }).actor.list(1),
    ).toEqual(unavailable);
    expect(
      await setup({
        requests: [],
        policy: { version: ids.policy, access_effect: 'terminate_access' },
        page: 1,
        more_available: false,
      }).actor.adminList(1),
    ).toEqual(unavailable);
  });
});
describe('refund service-role DB boundary', () => {
  it('reads only normalized private evidence snapshot', async () => {
    const { service, rpc, from } = setup({
      ...snapshot,
      credential_ciphertext: 'must-not-propagate',
    });
    expect(await service.read(ids.request)).toEqual({
      ok: true,
      data: snapshot,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('refund_read', {
      p_request_id: ids.request,
    });
    expect(from).not.toHaveBeenCalled();
  });
  it('claims by trusted actor identity and bounded lease without changing approved amount', async () => {
    const { service, rpc } = setup(snapshot);
    await service.claim(ids.request, ids.other, 180);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('refund_claim', {
      p_request_id: ids.request,
      p_actor_id: ids.other,
      p_lease_seconds: 180,
    });
  });
  it('records normalized outcome with lease and evidence only', async () => {
    const { service, rpc } = setup({ ...snapshot, state: 'unknown' });
    expect(
      (await service.outcome(ids.request, ids.key, 'unknown', ids.charge)).ok,
    ).toBe(true);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('refund_record_outcome', {
      p_request_id: ids.request,
      p_lease_token: ids.key,
      p_outcome: 'unknown',
      p_evidence_ref: ids.charge,
    });
  });
  it('finalizes immutable ledger only with normalized verified provider facts', async () => {
    const { service, rpc } = setup(ids.other);
    expect(await service.finalize(ids.request, verified, ids.key)).toEqual({
      ok: true,
      data: ids.other,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('refund_finalize', {
      p_request_id: ids.request,
      p_provider_action_id: verified.providerTransactionId,
      p_provider_payment_id: verified.providerPaymentId,
      p_amount_krw: verified.amountKrw,
      p_currency: 'KRW',
      p_refunded_at: verified.refundedAt,
      p_evidence_ref: ids.key,
    });
  });
  it.each([
    null,
    {},
    { ...snapshot, state: 'successful' },
    { ...snapshot, provider: 'mock' },
    { ...snapshot, environment: 'production' },
    { ...snapshot, amount_krw: 0 },
    { ...snapshot, provider_payment_id: 'secret / injection' },
  ])('rejects private evidence schema mismatch %#', async (value) => {
    expect(await setup(value).service.read(ids.request)).toEqual(unavailable);
  });
  it.each([null, {}, 'not-a-uuid'])(
    'rejects malformed finalization identity %#',
    async (value) => {
      expect(
        await setup(value).service.finalize(ids.request, verified, ids.key),
      ).toEqual(unavailable);
    },
  );
});
describe('safe database errors', () => {
  it.each([
    ['FORBIDDEN', 'FORBIDDEN'],
    ['REFUND_INVALID_INPUT', 'INVALID_INPUT'],
    ['REFUND_NOT_FOUND', 'NOT_FOUND'],
    ['REFUND_POLICY_NOT_APPROVED', 'POLICY_NOT_APPROVED'],
    ...[
      'REFUND_IDEMPOTENCY_CONFLICT',
      'REFUND_CHARGE_UNVERIFIED',
      'REFUND_EXCEEDS_CHARGE',
      'REFUND_ALREADY_OPEN',
      'REFUND_STATE_CONFLICT',
      'REFUND_AMOUNT_MISMATCH',
      'REFUND_OUTCOME_CONFLICT',
      'REFUND_RESULT_MISMATCH',
    ].map((message) => [message, 'CONFLICT']),
  ])('maps only exact allowlisted %s', async (message, code) => {
    const { actor, service } = setup(managementSubscription, {
      message,
      details: 'private-sql-detail',
      hint: 'private-hint',
    });
    expect(await actor.read(ids.subscription, 1)).toEqual({ ok: false, code });
    expect(await service.read(ids.request)).toEqual({ ok: false, code });
  });
  it.each([
    { message: 'FORBIDDEN with private context' },
    { message: 'secret SQL failure', code: '42501' },
    { message: '__proto__' },
    { message: 'constructor' },
    {},
    'private text',
  ])(
    'never reflects arbitrary error or prototype property %#',
    async (error) => {
      expect(await setup(null, error).actor.cancel(ids.subscription)).toEqual(
        unavailable,
      );
    },
  );
});
