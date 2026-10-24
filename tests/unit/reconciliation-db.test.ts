// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  RECONCILIATION_CANDIDATE_LIMIT,
  RECONCILIATION_LEASE_SECONDS,
} from '@/config/reconciliation';
import {
  createReconciliationDbPort,
  createEnrollmentReconciliationCasePort,
} from '@/server/db/reconciliation';
import type { CheckoutServiceClient } from '@/server/db/checkout-client';
import {
  reconciliationIds as ids,
  reconciliationSnapshot,
  reconciliationCharge,
} from './reconciliation-worker-fixtures';
const unavailable = { ok: false, code: 'UNAVAILABLE' };
const payment = {
  providerTransactionId: reconciliationCharge.providerTransactionId,
  providerPaymentId: reconciliationCharge.providerPaymentId,
  amountKrw: 1000,
  currency: 'KRW' as const,
  occurredAt: reconciliationCharge.approvedAt,
};
function setup(data: unknown = reconciliationSnapshot, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  const from = vi.fn(() => {
    throw new Error('Direct SQL forbidden');
  });
  return {
    rpc,
    from,
    db: createReconciliationDbPort({
      rpc,
      from,
    } as unknown as CheckoutServiceClient),
  };
}
describe('private reconciliation database RPC adapter', () => {
  it('requests only the bounded candidate list', async () => {
    const { db, rpc, from } = setup([ids.case]);
    expect(await db.candidates(RECONCILIATION_CANDIDATE_LIMIT)).toEqual({
      ok: true,
      data: [ids.case],
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('reconciliation_candidates', {
      p_limit: RECONCILIATION_CANDIDATE_LIMIT,
    });
    expect(from).not.toHaveBeenCalled();
  });
  it('reads a safe snapshot with the opaque case ID and no caller identities', async () => {
    const { db, rpc, from } = setup();
    expect(await db.read(ids.case)).toEqual({
      ok: true,
      data: reconciliationSnapshot,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('reconciliation_read', {
      p_case_id: ids.case,
    });
    expect(from).not.toHaveBeenCalled();
  });
  it('claims only a reconciliation lease, never a charge or refund', async () => {
    const { db, rpc } = setup();
    expect(await db.claim(ids.case, RECONCILIATION_LEASE_SECONDS)).toEqual({
      ok: true,
      data: reconciliationSnapshot,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('reconciliation_claim', {
      p_case_id: ids.case,
      p_lease_seconds: RECONCILIATION_LEASE_SECONDS,
    });
  });
  it('passes only verified financial fields plus the lease/evidence to atomic finalization', async () => {
    const { db, rpc } = setup();
    expect(
      await db.complete(
        ids.case,
        ids.lease,
        {
          ...payment,
          ...{ raw: { secret: 'private' }, customerName: 'private' },
        },
        ids.evidence,
      ),
    ).toEqual({ ok: true, data: reconciliationSnapshot });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('reconciliation_complete', {
      p_case_id: ids.case,
      p_lease_token: ids.lease,
      p_provider_action_id: payment.providerTransactionId,
      p_provider_payment_id: payment.providerPaymentId,
      p_amount_krw: 1000,
      p_currency: 'KRW',
      p_occurred_at: payment.occurredAt,
      p_evidence_ref: ids.evidence,
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('private');
  });
  it('defers only the claimed unknown operation without failure/recharge authority', async () => {
    const { db, rpc } = setup();
    expect(await db.defer(ids.case, ids.lease)).toEqual({
      ok: true,
      data: reconciliationSnapshot,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('reconciliation_defer', {
      p_case_id: ids.case,
      p_lease_token: ids.lease,
    });
    expect(Object.keys(db)).toEqual([
      'candidates',
      'read',
      'claim',
      'complete',
      'defer',
    ]);
  });
  it.each([
    null,
    {},
    ['not-a-uuid'],
    Array(RECONCILIATION_CANDIDATE_LIMIT + 1).fill(ids.case),
  ])('rejects malformed/oversized candidate projection %j', async (data) => {
    expect(
      await setup(data).db.candidates(RECONCILIATION_CANDIDATE_LIMIT),
    ).toEqual(unavailable);
  });
  it.each([
    null,
    {},
    [],
    { ...reconciliationSnapshot, private_credential: 'forbidden' },
    { ...reconciliationSnapshot, amount_krw: 0 },
    { ...reconciliationSnapshot, amount_krw: Infinity },
    { ...reconciliationSnapshot, provider_payment_id: 'bad payment' },
    { ...reconciliationSnapshot, operation_started_at: 'not-a-date' },
    { ...reconciliationSnapshot, query_attempts: 4 },
    { ...reconciliationSnapshot, lease_token: 'bad-token' },
  ])('rejects strict malformed worker snapshot %j', async (data) => {
    const { db } = setup(data);
    expect(await db.read(ids.case)).toEqual(unavailable);
    expect(await db.claim(ids.case, RECONCILIATION_LEASE_SECONDS)).toEqual(
      unavailable,
    );
    expect(
      await db.complete(ids.case, ids.lease, payment, ids.evidence),
    ).toEqual(unavailable);
    expect(await db.defer(ids.case, ids.lease)).toEqual(unavailable);
  });
  it.each([
    { message: 'FORBIDDEN' },
    { message: 'private customer/secret' },
    'network',
    true,
  ])('redacts all RPC error detail %j', async (error) => {
    const { db } = setup(reconciliationSnapshot, error);
    expect(await db.read(ids.case)).toEqual(unavailable);
    expect(await db.claim(ids.case, RECONCILIATION_LEASE_SECONDS)).toEqual(
      unavailable,
    );
    expect(
      await db.complete(ids.case, ids.lease, payment, ids.evidence),
    ).toEqual(unavailable);
    expect(await db.defer(ids.case, ids.lease)).toEqual(unavailable);
    expect(await db.candidates(RECONCILIATION_CANDIDATE_LIMIT)).toEqual(
      unavailable,
    );
  });
});

describe('initial enrollment reconciliation case bridge', () => {
  it('uses persisted actor and session identity to obtain a shared bounded case', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ids.case, error: null });
    const db = createEnrollmentReconciliationCasePort({
      rpc,
    } as unknown as CheckoutServiceClient);
    expect(await db.enrollmentCase(ids.customer, ids.target)).toEqual({
      ok: true,
      data: ids.case,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'reconciliation_enrollment_case',
      { p_user_id: ids.customer, p_session_id: ids.target },
    );
    expect(Object.keys(db)).toEqual(['enrollmentCase']);
  });
  it.each([null, 'bad-uuid', { id: ids.case }])(
    'rejects malformed case identifier %j',
    async (data) => {
      const rpc = vi.fn().mockResolvedValue({ data, error: null });
      const db = createEnrollmentReconciliationCasePort({
        rpc,
      } as unknown as CheckoutServiceClient);
      expect(await db.enrollmentCase(ids.customer, ids.target)).toEqual(
        unavailable,
      );
    },
  );
  it('returns no private cause if persisted enrollment binding is rejected', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: ids.case,
      error: { message: 'private enrollment mismatch' },
    });
    const db = createEnrollmentReconciliationCasePort({
      rpc,
    } as unknown as CheckoutServiceClient);
    expect(await db.enrollmentCase(ids.customer, ids.target)).toEqual(
      unavailable,
    );
  });
});
