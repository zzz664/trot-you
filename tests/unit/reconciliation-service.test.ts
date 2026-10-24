// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  RECONCILIATION_CANDIDATE_LIMIT,
  RECONCILIATION_LEASE_SECONDS,
} from '@/config/reconciliation';
import { reconcilePayments } from '@/server/services/reconciliation/process';
import type { ReconciliationSnapshot } from '@/server/services/reconciliation/model';
import {
  reconciliationIds as ids,
  reconciliationSnapshot,
  reconciliationCharge,
  reconciliationRefundSnapshot,
  reconciliationRefund,
} from './reconciliation-worker-fixtures';
const unavailable = { ok: false, code: 'UNAVAILABLE' } as const;
const unknown = {
  ok: false,
  code: 'OUTCOME_UNKNOWN',
  outcome: 'unknown',
} as const;
const success = (data: unknown) => ({ ok: true, data });
function setup(patch: Partial<ReconciliationSnapshot> = {}) {
  const row = { ...reconciliationSnapshot, ...patch };
  const claimed = {
    ...row,
    state: 'processing' as const,
    dispatch: true,
    lease_token: ids.lease,
    query_attempts: 1,
  };
  const processed = {
    ...row,
    state: 'processed' as const,
    payment_event_id: ids.event,
    query_attempts: 1,
  };
  const db = {
    candidates: vi.fn().mockResolvedValue(success([row.id])),
    read: vi.fn().mockResolvedValue(success(row)),
    claim: vi.fn().mockResolvedValue(success(claimed)),
    complete: vi.fn().mockResolvedValue(success(processed)),
    defer: vi.fn().mockResolvedValue(
      success({
        ...row,
        state: 'retry',
        reason: 'QUERY_UNCONFIRMED',
        query_attempts: 1,
      }),
    ),
  };
  const query = () =>
    vi.fn().mockResolvedValue(
      success({
        ...reconciliationCharge,
        merchantAccount: row.merchant_account,
      }),
    );
  const refundQuery = () =>
    vi.fn().mockResolvedValue(
      success({
        ...reconciliationRefund,
        merchantAccount: row.merchant_account,
      }),
    );
  const toss = { charge: { query: query() }, refund: { query: refundQuery() } };
  const kakao = {
    charge: { query: query() },
    refund: { query: refundQuery() },
  };
  const deps = {
    db,
    toss,
    kakao,
    configuration: vi.fn().mockReturnValue({
      environment: row.environment,
      merchant: row.merchant_account,
    }),
    evidenceRef: vi.fn(() => ids.evidence),
    now: vi.fn(() => Date.parse('2026-10-24T13:00:00Z')),
  };
  return { deps, db, row, claimed, processed };
}
function queryCount(deps: ReturnType<typeof setup>['deps']) {
  return [
    deps.toss.charge.query,
    deps.toss.refund.query,
    deps.kakao.charge.query,
    deps.kakao.refund.query,
  ].reduce((n, fn) => n + fn.mock.calls.length, 0);
}
async function expectUnknown(env: ReturnType<typeof setup>) {
  expect(await reconcilePayments(env.deps)).toMatchObject({
    ok: true,
    data: { queried: 1, settled: 0, unknown: 1 },
  });
  expect(env.db.defer).toHaveBeenCalledExactlyOnceWith(env.row.id, ids.lease);
  expect(env.db.complete).not.toHaveBeenCalled();
  expect(queryCount(env.deps)).toBe(1);
}
describe('bounded query-only payment reconciliation', () => {
  it.each(['initial', 'renewal'] as const)(
    'queries stored Toss %s identity and settles exactly once',
    async (kind) => {
      const { deps, db } = setup({ kind });
      expect(await reconcilePayments(deps)).toEqual({
        ok: true,
        data: {
          examined: 1,
          queried: 1,
          settled: 1,
          unknown: 0,
          manualReview: 0,
          skipped: 0,
        },
      });
      expect(db.candidates).toHaveBeenCalledExactlyOnceWith(
        RECONCILIATION_CANDIDATE_LIMIT,
      );
      expect(db.claim).toHaveBeenCalledExactlyOnceWith(
        ids.case,
        RECONCILIATION_LEASE_SECONDS,
      );
      expect(deps.configuration).toHaveBeenCalledWith('toss_card_billing');
      expect(deps.toss.charge.query).toHaveBeenCalledExactlyOnceWith({
        customerRef: ids.customer,
        orderId: ids.target,
        amountKrw: 1000,
        providerPaymentId: 'fictional-payment',
      });
      expect(db.complete).toHaveBeenCalledExactlyOnceWith(
        ids.case,
        ids.lease,
        {
          ...reconciliationCharge,
          occurredAt: reconciliationCharge.approvedAt,
        },
        ids.evidence,
      );
      expect(db.defer).not.toHaveBeenCalled();
      expect(queryCount(deps)).toBe(1);
      expect(Object.keys(deps.toss.charge)).toEqual(['query']);
    },
  );
  it('can query a lost Toss payment identity by the original order without a new charge', async () => {
    const env = setup({ provider_payment_id: null });
    env.db.complete.mockResolvedValue(
      success({
        ...env.processed,
        provider_payment_id: reconciliationCharge.providerPaymentId,
      }),
    );
    expect((await reconcilePayments(env.deps)).ok).toBe(true);
    expect(env.deps.toss.charge.query).toHaveBeenCalledWith({
      customerRef: ids.customer,
      orderId: ids.target,
      amountKrw: 1000,
    });
    expect(queryCount(env.deps)).toBe(1);
  });
  it.each(['initial', 'renewal'] as const)(
    'routes known-TID Kakao %s only through Kakao query',
    async (kind) => {
      const { deps } = setup({
        kind,
        provider: 'kakaopay',
        merchant_account: 'TCSUBSCRIP',
      });
      expect((await reconcilePayments(deps)).ok).toBe(true);
      expect(deps.configuration).toHaveBeenCalledWith('kakaopay_subscription');
      expect(deps.kakao.charge.query).toHaveBeenCalledOnce();
      expect(deps.toss.charge.query).not.toHaveBeenCalled();
    },
  );
  it.each(['toss', 'kakaopay'] as const)(
    'queries only an already dispatched authorized %s refund',
    async (provider) => {
      const env = setup({ ...reconciliationRefundSnapshot, provider });
      expect(await reconcilePayments(env.deps)).toMatchObject({
        ok: true,
        data: { queried: 1, settled: 1 },
      });
      const adapter = provider === 'toss' ? env.deps.toss : env.deps.kakao;
      expect(adapter.refund.query).toHaveBeenCalledWith({
        attemptId: ids.target,
        orderId: ids.target,
        customerRef: ids.customer,
        providerPaymentId: 'fictional-payment',
        originalProviderTransactionId: 'fictional-charge-action',
        originalAmountKrw: 1000,
        amountKrw: 300,
        refundedBeforeKrw: 200,
        currency: 'KRW',
        taxBasis: 'taxable_krw',
      });
      expect(adapter.charge.query).not.toHaveBeenCalled();
      expect(env.db.complete).toHaveBeenCalledWith(
        ids.case,
        ids.lease,
        {
          ...reconciliationRefund,
          occurredAt: reconciliationRefund.refundedAt,
        },
        ids.evidence,
      );
    },
  );
  it('scans at most four cases and performs at most one provider request', async () => {
    const env = setup();
    env.db.candidates.mockResolvedValue(
      success([ids.case, ids.other, ids.third, ids.fourth]),
    );
    env.db.read.mockImplementation(async (id: string) =>
      success({
        ...env.row,
        id,
        state:
          id === ids.case
            ? 'manual_review'
            : id === ids.other
              ? 'processed'
              : 'pending',
      }),
    );
    env.db.claim.mockImplementation(async (id: string) =>
      success({ ...env.claimed, id }),
    );
    env.db.complete.mockImplementation(async (id: string) =>
      success({ ...env.processed, id }),
    );
    expect(await reconcilePayments(env.deps)).toMatchObject({
      ok: true,
      data: {
        examined: 3,
        queried: 1,
        manualReview: 1,
        skipped: 1,
        settled: 1,
      },
    });
    expect(env.db.read).toHaveBeenCalledTimes(3);
    expect(queryCount(env.deps)).toBe(1);
  });
  it.each([
    { candidates: [] },
    { candidates: [ids.case, ids.case] },
    { candidates: ['not-a-uuid'] },
    { candidates: [ids.case, ids.other, ids.third, ids.fourth, ids.target] },
  ])('bounds candidate input %j before any read', async ({ candidates }) => {
    const env = setup();
    env.db.candidates.mockResolvedValue(success(candidates));
    const result = await reconcilePayments(env.deps);
    expect(result).toEqual(
      candidates.length === 0
        ? {
            ok: true,
            data: {
              examined: 0,
              queried: 0,
              settled: 0,
              unknown: 0,
              manualReview: 0,
              skipped: 0,
            },
          }
        : unavailable,
    );
    expect(env.db.read).not.toHaveBeenCalled();
    expect(queryCount(env.deps)).toBe(0);
  });
  it.each([
    null,
    { environment: 'live', merchant: 'fictional-mid' },
    { environment: 'test', merchant: 'wrong-mid' },
  ])(
    'skips mismatched configuration %j without a claim or query',
    async (config) => {
      const env = setup();
      env.deps.configuration.mockReturnValue(config);
      expect(await reconcilePayments(env.deps)).toMatchObject({
        ok: true,
        data: { skipped: 1, queried: 0 },
      });
      expect(env.db.claim).not.toHaveBeenCalled();
    },
  );
  it.each(['retry', 'processing', 'processed', 'manual_review'] as const)(
    'a non-dispatch shared claim in %s state makes no external call',
    async (state) => {
      const env = setup();
      env.db.claim.mockResolvedValue(success({ ...env.row, state }));
      expect(await reconcilePayments(env.deps)).toMatchObject({
        ok: true,
        data: { queried: 0, manualReview: state === 'manual_review' ? 1 : 0 },
      });
      expect(queryCount(env.deps)).toBe(0);
      expect(env.db.complete).not.toHaveBeenCalled();
    },
  );
  it('records missing Kakao TID as review through the claim, never queries SID or another provider', async () => {
    const env = setup({ provider: 'kakaopay', provider_payment_id: null });
    env.db.claim.mockResolvedValue(
      success({
        ...env.row,
        state: 'manual_review',
        reason: 'PAYMENT_ID_MISSING',
      }),
    );
    expect(await reconcilePayments(env.deps)).toMatchObject({
      ok: true,
      data: { manualReview: 1, queried: 0 },
    });
    expect(queryCount(env.deps)).toBe(0);
  });
  it('rejects even a malformed dispatch claim for missing Kakao TID', async () => {
    const env = setup({ provider: 'kakaopay', provider_payment_id: null });
    expect(await reconcilePayments(env.deps)).toEqual(unavailable);
    expect(queryCount(env.deps)).toBe(0);
  });
  it.each([
    { id: ids.other },
    { target_id: ids.other },
    { subscription_id: ids.other },
    { kind: 'initial' },
    { provider: 'kakaopay' },
    { environment: 'live' },
    { merchant_account: 'another-mid' },
    { customer_ref: ids.other },
    { order_id: ids.other },
    { amount_krw: 2000 },
    { provider_payment_id: 'different-payment' },
    { provider_charge_action_id: 'different-action' },
    { original_amount_krw: 2000 },
    { refunded_before_krw: 1 },
    { authorized_at: '2026-10-24T12:01:00Z' },
    { operation_started_at: '2026-10-24T12:01:00Z' },
    { lease_token: null },
    { state: 'pending' },
  ])(
    'rejects identity/authority changed by claim %j before query',
    async (patch) => {
      const env = setup();
      env.db.claim.mockResolvedValue(success({ ...env.claimed, ...patch }));
      expect(await reconcilePayments(env.deps)).toEqual(unavailable);
      expect(queryCount(env.deps)).toBe(0);
    },
  );
  it.each([
    { orderId: ids.other },
    { customerRef: ids.other },
    { amountKrw: 999 },
    { currency: 'USD' },
    { merchantAccount: 'different-mid' },
    { providerPaymentId: 'different-payment' },
    { providerTransactionId: '' },
    { providerTransactionId: 'bad action' },
    { approvedAt: 'not-a-time' },
    { approvedAt: '2026-10-24T11:59:59Z' },
    { approvedAt: '2026-10-24T13:00:01Z' },
  ])(
    'rejects mismatched queried charge evidence %j without ledger recognition',
    async (patch) => {
      const env = setup();
      env.deps.toss.charge.query.mockResolvedValue(
        success({ ...reconciliationCharge, ...patch }),
      );
      await expectUnknown(env);
    },
  );
  it('allows provider timestamp precision at the dispatch second, not before it', async () => {
    const env = setup();
    env.deps.toss.charge.query.mockResolvedValue(
      success({ ...reconciliationCharge, approvedAt: '2026-10-24T12:00:00Z' }),
    );
    expect(await reconcilePayments(env.deps)).toMatchObject({
      ok: true,
      data: { settled: 1 },
    });
  });
  it.each([
    { attemptId: ids.other },
    { orderId: ids.other },
    { customerRef: ids.other },
    { providerPaymentId: 'different-payment' },
    { originalProviderTransactionId: 'different-charge' },
    { originalAmountKrw: 2000 },
    { amountKrw: 400 },
    { refundedBeforeKrw: 100 },
    { currency: 'USD' },
    { taxBasis: 'tax-free' },
    { merchantAccount: 'different-mid' },
    { providerTransactionId: 'fictional-charge-action' },
    { providerTransactionId: 'bad action' },
    { cumulativeRefundedKrw: 501 },
    { remainingKrw: 499 },
    { refundedAt: 'not-a-time' },
    { refundedAt: '2026-10-24T11:59:59Z' },
    { refundedAt: '2026-10-24T13:00:01Z' },
  ])(
    'rejects mismatched queried refund evidence %j without repeating refund',
    async (patch) => {
      const env = setup(reconciliationRefundSnapshot);
      env.deps.toss.refund.query.mockResolvedValue(
        success({ ...reconciliationRefund, ...patch }),
      );
      await expectUnknown(env);
    },
  );
  it.each([
    { provider_payment_id: null },
    { provider_charge_action_id: null },
    { original_amount_krw: null },
    { refunded_before_krw: null },
    { refunded_before_krw: 900 },
  ])('does not query an invalid refund identity %j', async (patch) => {
    const env = setup({ ...reconciliationRefundSnapshot, ...patch });
    expect(await reconcilePayments(env.deps)).toEqual(unavailable);
    expect(queryCount(env.deps)).toBe(0);
  });
  it('does not query a refund without its original authorization time', async () => {
    const env = setup({ ...reconciliationRefundSnapshot, authorized_at: null });
    expect(await reconcilePayments(env.deps)).toEqual(unavailable);
    expect(queryCount(env.deps)).toBe(0);
    expect(env.db.complete).not.toHaveBeenCalled();
    expect(env.db.defer).not.toHaveBeenCalled();
  });
  it.each([
    unknown,
    { ok: false, code: 'PROVIDER_REJECTED', outcome: 'rejected' },
    { ok: false, code: 'NOT_FOUND', outcome: 'unknown' },
    { ok: true, data: null },
  ])(
    'unconfirmed query result %j is not permission to recharge or refund',
    async (result) => {
      const env = setup();
      env.deps.toss.charge.query.mockResolvedValue(result);
      await expectUnknown(env);
    },
  );
  it('treats a thrown timeout as unknown and stops after the one query', async () => {
    const env = setup();
    env.deps.toss.charge.query.mockRejectedValue(
      new Error('private transport response'),
    );
    await expectUnknown(env);
  });
  it('leaves Kakao initial credential loss in manual review without fabricated entitlement', async () => {
    const env = setup({ provider: 'kakaopay', kind: 'initial' });
    env.db.complete.mockResolvedValue(
      success({
        ...env.row,
        state: 'manual_review',
        reason: 'CREDENTIAL_MISSING',
      }),
    );
    expect(await reconcilePayments(env.deps)).toMatchObject({
      ok: true,
      data: { queried: 1, settled: 0, manualReview: 1 },
    });
    expect(env.db.complete).toHaveBeenCalledOnce();
    expect(queryCount(env.deps)).toBe(1);
  });
  it('marks exhausted query budget as manual attention while preserving unknown money', async () => {
    const env = setup();
    env.deps.toss.charge.query.mockResolvedValue(unknown);
    env.db.defer.mockResolvedValue(
      success({
        ...env.row,
        state: 'manual_review',
        reason: 'QUERY_BUDGET_EXHAUSTED',
        query_attempts: 3,
      }),
    );
    expect(await reconcilePayments(env.deps)).toMatchObject({
      ok: true,
      data: { settled: 0, unknown: 1, manualReview: 1 },
    });
  });
  it('observes a lost successful commit reply and verifies only exact DB finalization', async () => {
    const env = setup();
    env.db.complete
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(success(env.processed));
    env.db.read
      .mockResolvedValueOnce(success(env.row))
      .mockResolvedValueOnce(success(env.processed));
    expect(await reconcilePayments(env.deps)).toMatchObject({
      ok: true,
      data: { settled: 1 },
    });
    expect(queryCount(env.deps)).toBe(1);
    expect(env.db.complete).toHaveBeenCalledTimes(2);
    expect(env.db.complete.mock.calls[1]).toEqual(
      env.db.complete.mock.calls[0],
    );
  });
  it('replays only identical DB finalization after a lost reply with redacted observed lease token', async () => {
    const env = setup();
    env.db.complete
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(success(env.processed));
    env.db.read
      .mockResolvedValueOnce(success(env.row))
      .mockResolvedValueOnce(
        success({ ...env.claimed, dispatch: false, lease_token: null }),
      );
    expect(await reconcilePayments(env.deps)).toMatchObject({
      ok: true,
      data: { settled: 1 },
    });
    expect(env.db.complete).toHaveBeenCalledTimes(2);
    expect(env.db.complete.mock.calls[1]).toEqual(
      env.db.complete.mock.calls[0],
    );
    expect(env.deps.evidenceRef).toHaveBeenCalledOnce();
    expect(queryCount(env.deps)).toBe(1);
  });
  it('stops on exact DB replay failure instead of retrying the provider', async () => {
    const env = setup();
    env.db.complete.mockResolvedValue(unavailable);
    env.db.read
      .mockResolvedValueOnce(success(env.row))
      .mockResolvedValueOnce(
        success({ ...env.claimed, dispatch: false, lease_token: null }),
      );
    expect(await reconcilePayments(env.deps)).toEqual(unavailable);
    expect(env.db.complete).toHaveBeenCalledTimes(2);
    expect(queryCount(env.deps)).toBe(1);
  });
  it('handles thrown complete reply loss with the same bounded observation path', async () => {
    const env = setup();
    env.db.complete
      .mockRejectedValueOnce(new Error('reply lost'))
      .mockResolvedValueOnce(success(env.processed));
    env.db.read
      .mockResolvedValueOnce(success(env.row))
      .mockResolvedValueOnce(
        success({ ...env.claimed, dispatch: false, lease_token: null }),
      );
    expect(await reconcilePayments(env.deps)).toMatchObject({
      ok: true,
      data: { settled: 1 },
    });
    expect(env.db.complete).toHaveBeenCalledTimes(2);
    expect(queryCount(env.deps)).toBe(1);
  });
  it.each([
    { id: ids.other },
    { amount_krw: 999 },
    { provider_payment_id: 'different-payment' },
  ])(
    'does not accept a mismatched observed terminal result %j',
    async (patch) => {
      const env = setup();
      env.db.complete.mockResolvedValue(unavailable);
      env.db.read
        .mockResolvedValueOnce(success(env.row))
        .mockResolvedValueOnce(success({ ...env.processed, ...patch }));
      expect(await reconcilePayments(env.deps)).toEqual(unavailable);
      expect(env.db.complete).toHaveBeenCalledOnce();
      expect(queryCount(env.deps)).toBe(1);
    },
  );
  it.each([
    { amount_krw: 999 },
    { customer_ref: ids.other },
    { provider_payment_id: 'different-payment' },
    { payment_event_id: null },
  ])(
    'rejects inconsistent successful finalization projection %j',
    async (patch) => {
      const env = setup();
      env.db.complete.mockResolvedValue(
        success({ ...env.processed, ...patch }),
      );
      expect(await reconcilePayments(env.deps)).toEqual(unavailable);
      expect(queryCount(env.deps)).toBe(1);
    },
  );
  it.each(['read', 'claim'] as const)(
    'fails closed on malformed %s projection before query',
    async (operation) => {
      const env = setup();
      env.db[operation].mockResolvedValue(
        success({ ...env.claimed, private_credential: 'forbidden' }),
      );
      expect(await reconcilePayments(env.deps)).toEqual(unavailable);
      expect(queryCount(env.deps)).toBe(0);
    },
  );
  it('rejects malformed deferred storage outcome instead of announcing a saved unknown result', async () => {
    const env = setup();
    env.deps.toss.charge.query.mockResolvedValue(unknown);
    env.db.defer.mockResolvedValue(success({ id: ids.case, state: 'retry' }));
    expect(await reconcilePayments(env.deps)).toEqual(unavailable);
    expect(queryCount(env.deps)).toBe(1);
  });
  it.each(['candidates', 'read', 'claim', 'defer'] as const)(
    'redacts %s storage failures',
    async (operation) => {
      const env = setup();
      env.deps.toss.charge.query.mockResolvedValue(unknown);
      env.db[operation].mockRejectedValue(
        new Error('private provider/key/user data'),
      );
      expect(await reconcilePayments(env.deps)).toEqual(unavailable);
      expect(queryCount(env.deps)).toBeLessThanOrEqual(1);
    },
  );
});
