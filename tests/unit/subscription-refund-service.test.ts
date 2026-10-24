// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runRefund,
  type RefundDependencies,
} from '@/server/services/subscription/refund';
import type {
  ManagementDbPort,
  RefundSnapshot,
} from '@/server/services/subscription/management-model';
import type { VerifiedRefund } from '@/server/adapters/payment/refund';
import {
  managementAuthorized,
  managementIds as id,
} from './management-fixtures';
const ok = <T>(data: T) => ({ ok: true as const, data });
const unavailable = { ok: false as const, code: 'UNAVAILABLE' as const };
const ids = {
  actor: 'ab160000-0000-4000-8000-000000000011',
  user: 'ab160000-0000-4000-8000-000000000012',
  order: 'ab160000-0000-4000-8000-000000000013',
  customer: 'ab160000-0000-4000-8000-000000000014',
  lease: 'ab160000-0000-4000-8000-000000000015',
  event: 'ab160000-0000-4000-8000-000000000016',
  evidence: 'ab160000-0000-4000-8000-000000000017',
};
const original: RefundSnapshot = {
  request_id: id.request,
  subscription_id: id.subscription,
  user_id: ids.user,
  original_event_id: id.charge,
  state: 'authorized',
  amount_krw: 500,
  currency: 'KRW',
  provider: 'toss',
  environment: 'test',
  merchant_account: 'fixture-merchant',
  customer_ref: ids.customer,
  order_id: ids.order,
  provider_payment_id: 'fixture-payment',
  provider_charge_action_id: 'fixture-charge-action',
  charge_amount_krw: 1000,
  refunded_before_krw: 0,
  policy_version: id.policy,
  payment_tax_basis: 'taxable_krw',
  requested_at: '2026-10-24T12:00:00Z',
  authorized_at: '2026-10-24T12:30:00Z',
  action: 'refund',
  reason: null,
  dispatch: false,
  lease_token: null,
  payment_event_id: null,
};
const proof: VerifiedRefund = {
  attemptId: id.request,
  orderId: ids.order,
  customerRef: ids.customer,
  providerPaymentId: 'fixture-payment',
  originalProviderTransactionId: 'fixture-charge-action',
  originalAmountKrw: 1000,
  amountKrw: 500,
  refundedBeforeKrw: 0,
  currency: 'KRW',
  taxBasis: 'taxable_krw',
  providerTransactionId: 'fixture-refund-action',
  refundedAt: '2026-10-24T12:31:00Z',
  cumulativeRefundedKrw: 500,
  remainingKrw: 500,
  merchantAccount: 'fixture-merchant',
};
const db = {
  read: vi.fn(),
  claim: vi.fn(),
  outcome: vi.fn(),
  finalize: vi.fn(),
};
const toss = { refund: vi.fn(), query: vi.fn() };
const kakao = { refund: vi.fn(), query: vi.fn() };
const actorDb = {
  list: vi.fn(),
  read: vi.fn(),
  cancel: vi.fn(),
  request: vi.fn(),
  adminList: vi.fn(),
  adminRead: vi.fn(),
  authorize: vi.fn(),
  reject: vi.fn(),
} satisfies ManagementDbPort;
let row: RefundSnapshot;
let safe = structuredClone(managementAuthorized);
let deps: RefundDependencies;
const run = (
  mode: 'execute' | 'reconcile' = 'execute',
  input: unknown = { requestId: id.request },
  actor = ids.actor,
) => runRefund(deps, actorDb, actor, input, mode);
beforeEach(() => {
  vi.resetAllMocks();
  row = { ...original };
  safe = structuredClone(managementAuthorized);
  deps = {
    db,
    toss,
    kakao,
    dispatchEnabled: true,
    configuration: vi.fn(() => ({
      environment: 'test' as const,
      merchant: 'fixture-merchant',
    })),
    evidenceRef: vi.fn(() => ids.evidence),
    now: () => Date.parse('2026-10-24T12:32:00Z'),
  };
  actorDb.adminRead.mockImplementation(async () => ok(safe));
  db.read.mockImplementation(async () => ok({ ...row }));
  db.claim.mockImplementation(async () => {
    if (row.action === 'lease_expired') {
      row = { ...row, state: 'unknown', action: 'reconcile' };
      safe.request.status = 'unknown';
      return ok({ ...row });
    }
    row = {
      ...row,
      state: row.action === 'refund' ? 'inflight' : 'unknown',
      lease_token: ids.lease,
      dispatch: true,
    };
    return ok({ ...row });
  });
  db.outcome.mockImplementation(async (_id, _lease, outcome) => {
    row = { ...row, state: outcome, dispatch: false, action: 'none' };
    safe.request.status = outcome;
    return ok({ ...row });
  });
  db.finalize.mockImplementation(async () => {
    row = { ...row, state: 'succeeded', payment_event_id: ids.event };
    safe.request.status = 'succeeded';
    safe.request.refunded_krw = 500;
    return ok(ids.event);
  });
  toss.refund.mockResolvedValue(ok(proof));
  toss.query.mockResolvedValue(ok(proof));
  kakao.refund.mockResolvedValue(ok(proof));
  kakao.query.mockResolvedValue(ok(proof));
});
describe('authorized refund orchestration', () => {
  it.each(['toss', 'kakaopay'] as const)(
    'dispatches only %s original provider and finalizes exact proof once',
    async (provider) => {
      row.provider = provider;
      const result = await run();
      expect(result.ok && result.data.request.status).toBe('succeeded');
      const chosen = provider === 'toss' ? toss : kakao,
        other = provider === 'toss' ? kakao : toss;
      expect(chosen.refund).toHaveBeenCalledOnce();
      expect(other.refund).not.toHaveBeenCalled();
      expect(chosen.query).not.toHaveBeenCalled();
      expect(db.claim).toHaveBeenCalledExactlyOnceWith(
        id.request,
        ids.actor,
        180,
      );
      expect(db.finalize).toHaveBeenCalledExactlyOnceWith(
        id.request,
        proof,
        ids.evidence,
      );
      expect(actorDb.cancel).not.toHaveBeenCalled();
      expect(actorDb.authorize).not.toHaveBeenCalled();
    },
  );
  it.each(['toss', 'kakaopay'] as const)(
    'queries %s unknown operation without another monetary dispatch even when disabled',
    async (provider) => {
      row = { ...row, provider, state: 'unknown', action: 'reconcile' };
      safe.request.status = 'unknown';
      deps.dispatchEnabled = false;
      expect((await run('reconcile')).ok).toBe(true);
      const chosen = provider === 'toss' ? toss : kakao;
      expect(chosen.query).toHaveBeenCalledOnce();
      expect(chosen.refund).not.toHaveBeenCalled();
    },
  );
  it('refuses monetary execution when disabled before claiming', async () => {
    deps.dispatchEnabled = false;
    expect(await run()).toEqual({ ok: false, code: 'EXECUTION_DISABLED' });
    expect(db.claim).not.toHaveBeenCalled();
  });
  it('authenticates actor via actor-scoped current-admin RPC before private read', async () => {
    actorDb.adminRead.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    expect(await run()).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(db.read).not.toHaveBeenCalled();
    expect(db.claim).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {},
    { requestId: 'invalid' },
    { requestId: id.request, amountKrw: 1 },
    { requestId: id.request, actorId: ids.actor },
  ])('rejects malformed command %# before auth/private I/O', async (input) => {
    expect(await run('execute', input)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(actorDb.adminRead).not.toHaveBeenCalled();
  });
  it('rejects malformed trusted actor identifier', async () => {
    expect(await run('execute', { requestId: id.request }, 'bad')).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(db.read).not.toHaveBeenCalled();
  });
  it.each([
    { request_id: id.other },
    { original_event_id: id.other },
    { subscription_id: id.other },
    { amount_krw: 499 },
  ])('rejects private/public request mismatch %#', async (change) => {
    row = { ...row, ...change };
    expect(await run()).toEqual(unavailable);
    expect(db.claim).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { environment: 'live', merchant: 'fixture-merchant' },
    { environment: 'test', merchant: 'other' },
  ])(
    'rejects wrong configured merchant/environment %# before claim',
    async (config) => {
      deps.configuration = vi.fn().mockReturnValue(config);
      expect(await run()).toEqual({ ok: false, code: 'SETUP_NOT_READY' });
      expect(db.claim).not.toHaveBeenCalled();
    },
  );
  it.each([
    { customer_ref: null },
    { order_id: null },
    { provider_payment_id: null },
    { refunded_before_krw: null },
    { refunded_before_krw: 600 },
    { payment_tax_basis: null },
  ])(
    'refuses incomplete/over-capacity immutable identity %#',
    async (change) => {
      row = { ...row, ...change };
      expect(await run()).toEqual(unavailable);
      expect(db.claim).not.toHaveBeenCalled();
    },
  );
  it.each(['none', 'manual_review', 'blocked'] as const)(
    'never dispatches action %s and refreshes public state',
    async (action) => {
      row.action = action;
      expect((await run()).ok).toBe(true);
      expect(db.claim).not.toHaveBeenCalled();
      expect(actorDb.adminRead).toHaveBeenCalledTimes(2);
      expect(toss.refund).not.toHaveBeenCalled();
    },
  );
  it('does not use execute route to query an unknown operation', async () => {
    row = { ...row, state: 'unknown', action: 'reconcile' };
    await run();
    expect(db.claim).not.toHaveBeenCalled();
    expect(toss.query).not.toHaveBeenCalled();
  });
  it('does not use reconcile route to dispatch an authorized refund', async () => {
    await run('reconcile');
    expect(db.claim).not.toHaveBeenCalled();
    expect(toss.refund).not.toHaveBeenCalled();
  });
  it('repairs expired inflight lease to unknown without provider configuration', async () => {
    row = { ...row, state: 'inflight', action: 'lease_expired' };
    deps.configuration = () => null;
    const result = await run('reconcile');
    expect(result.ok && result.data.request.status).toBe('unknown');
    expect(db.claim).toHaveBeenCalledOnce();
    expect(toss.query).not.toHaveBeenCalled();
    expect(toss.refund).not.toHaveBeenCalled();
  });
  it('does not dispatch after lost claim response', async () => {
    db.claim.mockResolvedValue(unavailable);
    expect(await run()).toEqual(unavailable);
    expect(toss.refund).not.toHaveBeenCalled();
  });
  it('does not dispatch when another caller already owns operation', async () => {
    db.claim.mockResolvedValue(
      ok({ ...row, state: 'inflight', dispatch: false, action: 'none' }),
    );
    await run();
    expect(toss.refund).not.toHaveBeenCalled();
  });
  it.each([
    { request_id: id.other },
    { user_id: id.other },
    { subscription_id: id.other },
    { original_event_id: id.other },
    { provider: 'kakaopay' },
    { environment: 'live' },
    { merchant_account: 'other' },
    { policy_version: id.other },
    { authorized_at: '2026-10-24T12:29:00Z' },
    { requested_at: '2026-10-24T11:59:00Z' },
    { amount_krw: 499 },
    { charge_amount_krw: 2000 },
    { currency: 'USD' },
    { customer_ref: id.other },
    { order_id: id.other },
    { provider_payment_id: 'other' },
    { provider_charge_action_id: 'other' },
    { refunded_before_krw: 1 },
    { payment_tax_basis: null },
    { lease_token: null },
    { state: 'authorized' },
    { action: 'reconcile' },
  ])(
    'rejects changed/invalid claim %# without external I/O',
    async (change) => {
      db.claim.mockResolvedValue(
        ok({
          ...row,
          state: 'inflight',
          dispatch: true,
          lease_token: ids.lease,
          ...change,
        }),
      );
      expect(await run()).toEqual(unavailable);
      expect(toss.refund).not.toHaveBeenCalled();
      expect(kakao.refund).not.toHaveBeenCalled();
    },
  );
});
describe('unknown outcomes and immutable recognition', () => {
  it('treats thrown transport as unknown, never a failed refund', async () => {
    toss.refund.mockRejectedValue(new Error('private payment id'));
    const result = await run();
    expect(result.ok && result.data.request.status).toBe('unknown');
    expect(db.outcome).toHaveBeenCalledExactlyOnceWith(
      id.request,
      ids.lease,
      'unknown',
      ids.evidence,
    );
    expect(db.finalize).not.toHaveBeenCalled();
  });
  it.each(['not_started', 'unknown'])(
    'conservatively keeps %s response unknown after durable claim',
    async (outcome) => {
      toss.refund.mockResolvedValue({
        ok: false,
        outcome,
        code: 'OUTCOME_UNKNOWN',
        retryAllowed: false,
      });
      await run();
      expect(db.outcome.mock.calls[0]?.[2]).toBe('unknown');
    },
  );
  it('allows only explicit definitive first-dispatch rejection to become failed', async () => {
    toss.refund.mockResolvedValue({
      ok: false,
      outcome: 'rejected',
      code: 'PROVIDER_REJECTED',
      retryAllowed: false,
    });
    await run();
    expect(db.outcome.mock.calls[0]?.[2]).toBe('failed');
  });
  it('does not promote a rejected query into definitive monetary failure', async () => {
    row = { ...row, state: 'unknown', action: 'reconcile' };
    toss.query.mockResolvedValue({
      ok: false,
      outcome: 'rejected',
      code: 'PROVIDER_REJECTED',
      retryAllowed: false,
    });
    await run('reconcile');
    expect(db.outcome.mock.calls[0]?.[2]).toBe('unknown');
  });
  it.each([
    { attemptId: id.other },
    { orderId: id.other },
    { customerRef: id.other },
    { providerPaymentId: 'other' },
    { originalProviderTransactionId: 'other' },
    { originalAmountKrw: 1001 },
    { amountKrw: 499 },
    { refundedBeforeKrw: 1 },
    { currency: 'USD' },
    { taxBasis: 'tax_free' },
    { providerTransactionId: '' },
    { providerTransactionId: 'bad action' },
    { providerTransactionId: 'fixture-charge-action' },
    { merchantAccount: 'wrong' },
    { remainingKrw: 499 },
    { cumulativeRefundedKrw: 499 },
    { refundedAt: 'not-a-date' },
    { refundedAt: '2026-10-24T12:29:59Z' },
    { refundedAt: '2026-10-24T12:32:01Z' },
  ])(
    'keeps mismatched provider proof %# unknown without ledger success',
    async (change) => {
      toss.refund.mockResolvedValue(ok({ ...proof, ...change }));
      const result = await run();
      expect(result.ok && result.data.request.status).toBe('unknown');
      expect(db.finalize).not.toHaveBeenCalled();
      expect(db.outcome.mock.calls[0]?.[2]).toBe('unknown');
    },
  );
  it('accepts provider second precision at the authorization second boundary', async () => {
    row.authorized_at = '2026-10-24T12:31:00.950Z';
    await run();
    expect(db.finalize).toHaveBeenCalledOnce();
  });
  it('observes successful finalization after lost commit reply with no monetary replay', async () => {
    db.finalize.mockImplementation(async () => {
      row = { ...row, state: 'succeeded', payment_event_id: ids.event };
      safe.request.status = 'succeeded';
      return unavailable;
    });
    expect((await run()).ok).toBe(true);
    expect(toss.refund).toHaveBeenCalledOnce();
    expect(db.finalize).toHaveBeenCalledOnce();
  });
  it('retries only identical financial finalization once after ambiguous DB write', async () => {
    db.finalize
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(ok(ids.event));
    expect((await run()).ok).toBe(true);
    expect(toss.refund).toHaveBeenCalledOnce();
    expect(db.finalize).toHaveBeenCalledTimes(2);
    expect(db.finalize.mock.calls[0]).toEqual(db.finalize.mock.calls[1]);
  });
  it.each(['failed', 'rejected', 'requested'] as const)(
    'does not overwrite unexpected %s state after failed finalization',
    async (state) => {
      db.finalize.mockImplementation(async () => {
        row = { ...row, state };
        return unavailable;
      });
      expect(await run()).toEqual(unavailable);
      expect(db.finalize).toHaveBeenCalledOnce();
      expect(toss.refund).toHaveBeenCalledOnce();
    },
  );
  it('does not retry finalize when outcome read is unavailable', async () => {
    db.read
      .mockResolvedValueOnce(ok({ ...row }))
      .mockResolvedValueOnce(unavailable);
    db.finalize.mockResolvedValue(unavailable);
    expect(await run()).toEqual(unavailable);
    expect(db.finalize).toHaveBeenCalledOnce();
  });
  it('does not hide unknown-state write failure or expose error details', async () => {
    toss.refund.mockResolvedValue({ ok: false, outcome: 'unknown' });
    db.outcome.mockResolvedValue(unavailable);
    expect(await run()).toEqual(unavailable);
  });
  it.each(['read', 'claim', 'finalize'] as const)(
    'bounds %s exceptions without provider replay',
    async (method) => {
      db[method].mockRejectedValue(new Error('provider-secret'));
      expect(await run()).toEqual(unavailable);
      expect(toss.refund.mock.calls.length).toBeLessThanOrEqual(1);
    },
  );
});
