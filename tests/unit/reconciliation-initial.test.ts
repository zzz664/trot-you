// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { recoverInitialPayment } from '@/server/services/reconciliation/initial';
import {
  reconciliationIds as ids,
  reconciliationSnapshot,
  reconciliationCharge,
} from './reconciliation-worker-fixtures';
const unavailable = { ok: false, code: 'UNAVAILABLE' } as const;
const success = (data: unknown) => ({ ok: true, data });
function setup() {
  const row = { ...reconciliationSnapshot, kind: 'initial' as const };
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
    candidates: vi
      .fn()
      .mockRejectedValue(
        new Error('Global scan forbidden from owner recovery'),
      ),
    read: vi.fn().mockResolvedValue(success(row)),
    claim: vi.fn().mockResolvedValue(success(claimed)),
    complete: vi.fn().mockResolvedValue(success(processed)),
    defer: vi.fn().mockResolvedValue(
      success({
        ...row,
        state: 'retry',
        query_attempts: 1,
        reason: 'QUERY_UNCONFIRMED',
      }),
    ),
  };
  const deps = {
    db,
    toss: {
      charge: {
        query: vi.fn().mockResolvedValue(success(reconciliationCharge)),
      },
      refund: { query: vi.fn() },
    },
    kakao: { charge: { query: vi.fn() }, refund: { query: vi.fn() } },
    configuration: vi
      .fn()
      .mockReturnValue({ environment: 'test', merchant: 'fictional-mid' }),
    evidenceRef: () => ids.evidence,
    now: () => Date.parse('2026-10-24T13:00:00Z'),
    enrollmentCase: vi.fn().mockResolvedValue(success(ids.case)),
  };
  return { deps, db, row, claimed, processed };
}
function expectNoQuery(deps: ReturnType<typeof setup>['deps']) {
  for (const provider of [deps.toss, deps.kakao]) {
    expect(provider.charge.query).not.toHaveBeenCalled();
    expect(provider.refund.query).not.toHaveBeenCalled();
  }
}
describe('owner initial-payment recovery uses one bound shared case', () => {
  it('uses exact persisted actor/session binding and never scans unrelated cases', async () => {
    const { deps, db } = setup();
    const originalCandidates = db.candidates;
    expect(await recoverInitialPayment(deps, ids.customer, ids.target)).toEqual(
      { ok: true, data: null },
    );
    expect(deps.enrollmentCase).toHaveBeenCalledExactlyOnceWith(
      ids.customer,
      ids.target,
    );
    expect(db.read).toHaveBeenCalledExactlyOnceWith(ids.case);
    expect(db.candidates).not.toHaveBeenCalled();
    expect(db.candidates).toBe(originalCandidates);
    expect(deps.toss.charge.query).toHaveBeenCalledOnce();
    expect(db.complete).toHaveBeenCalledOnce();
    expect(deps.toss.refund.query).not.toHaveBeenCalled();
    expect(deps.kakao.charge.query).not.toHaveBeenCalled();
  });
  it.each([
    ['', ids.target],
    ['not-a-uuid', ids.target],
    [ids.customer, ''],
    [ids.customer, 'not-a-uuid'],
  ])(
    'rejects malformed actor/session %s %s before any database access',
    async (actor, session) => {
      const { deps, db } = setup();
      expect(await recoverInitialPayment(deps, actor, session)).toEqual(
        unavailable,
      );
      expect(deps.enrollmentCase).not.toHaveBeenCalled();
      expect(db.read).not.toHaveBeenCalled();
      expectNoQuery(deps);
    },
  );
  it('does not treat another valid actor UUID as authorization', async () => {
    const { deps, db } = setup();
    deps.enrollmentCase.mockResolvedValue(unavailable);
    expect(await recoverInitialPayment(deps, ids.other, ids.target)).toEqual(
      unavailable,
    );
    expect(deps.enrollmentCase).toHaveBeenCalledExactlyOnceWith(
      ids.other,
      ids.target,
    );
    expect(db.read).not.toHaveBeenCalled();
    expectNoQuery(deps);
  });
  it.each([null, '', 'bad-case', { id: ids.case }])(
    'rejects malformed shared-case identity %j',
    async (caseId) => {
      const { deps, db } = setup();
      deps.enrollmentCase.mockResolvedValue(success(caseId));
      expect(
        await recoverInitialPayment(deps, ids.customer, ids.target),
      ).toEqual(unavailable);
      expect(db.read).not.toHaveBeenCalled();
      expectNoQuery(deps);
    },
  );
  it.each([
    { kind: 'renewal' },
    { kind: 'refund' },
    { target_id: ids.other },
    { id: ids.other },
  ])(
    'refuses a case of the wrong operation/session/identity %j before claim',
    async (patch) => {
      const { deps, db, row } = setup();
      db.read.mockResolvedValue(success({ ...row, ...patch }));
      expect(
        await recoverInitialPayment(deps, ids.customer, ids.target),
      ).toEqual(unavailable);
      expect(db.claim).not.toHaveBeenCalled();
      expectNoQuery(deps);
    },
  );
  it('rejects malformed private snapshot without leaking fields', async () => {
    const { deps, db, row } = setup();
    db.read.mockResolvedValue(
      success({ ...row, credential_ciphertext: 'private key' }),
    );
    expect(await recoverInitialPayment(deps, ids.customer, ids.target)).toEqual(
      unavailable,
    );
    expectNoQuery(deps);
  });
  it('does not permit a correct read to dispatch a changed claim target', async () => {
    const { deps, db, claimed } = setup();
    db.claim.mockResolvedValue(success({ ...claimed, target_id: ids.other }));
    expect(await recoverInitialPayment(deps, ids.customer, ids.target)).toEqual(
      unavailable,
    );
    expectNoQuery(deps);
  });
  it.each(['processed', 'manual_review'] as const)(
    'preserves existing %s result without new provider I/O',
    async (state) => {
      const { deps, db, row } = setup();
      db.read.mockResolvedValue(success({ ...row, state }));
      expect(
        await recoverInitialPayment(deps, ids.customer, ids.target),
      ).toEqual({ ok: true, data: null });
      expectNoQuery(deps);
      expect(db.claim).not.toHaveBeenCalled();
    },
  );
  it('shares a non-dispatch lease rather than bypassing another worker', async () => {
    const { deps, db, row } = setup();
    db.claim.mockResolvedValue(success({ ...row, state: 'processing' }));
    expect(await recoverInitialPayment(deps, ids.customer, ids.target)).toEqual(
      { ok: true, data: null },
    );
    expectNoQuery(deps);
    expect(db.complete).not.toHaveBeenCalled();
  });
  it('leaves an unconfirmed query unknown, does not repeat approval/charge and returns no private details', async () => {
    const { deps, db } = setup();
    deps.toss.charge.query.mockResolvedValue({
      ok: false,
      code: 'OUTCOME_UNKNOWN',
      outcome: 'unknown',
      raw: 'private-provider-response',
    });
    expect(await recoverInitialPayment(deps, ids.customer, ids.target)).toEqual(
      { ok: true, data: null },
    );
    expect(db.defer).toHaveBeenCalledExactlyOnceWith(ids.case, ids.lease);
    expect(db.complete).not.toHaveBeenCalled();
    expect(deps.toss.charge.query).toHaveBeenCalledOnce();
    expect(db.candidates).not.toHaveBeenCalled();
  });
  it('uses one exact DB-only recovery replay with redacted lease readback', async () => {
    const { deps, db, row, claimed, processed } = setup();
    db.complete
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(success(processed));
    db.read
      .mockResolvedValueOnce(success(row))
      .mockResolvedValueOnce(
        success({ ...claimed, dispatch: false, lease_token: null }),
      );
    expect(await recoverInitialPayment(deps, ids.customer, ids.target)).toEqual(
      { ok: true, data: null },
    );
    expect(db.complete).toHaveBeenCalledTimes(2);
    expect(db.complete.mock.calls[0]).toEqual(db.complete.mock.calls[1]);
    expect(deps.toss.charge.query).toHaveBeenCalledOnce();
    expect(db.candidates).not.toHaveBeenCalled();
  });
  it('rechecks bound operation on lost-response readback instead of accepting another case', async () => {
    const { deps, db, row, processed } = setup();
    db.complete.mockResolvedValue(unavailable);
    db.read
      .mockResolvedValueOnce(success(row))
      .mockResolvedValueOnce(success({ ...processed, target_id: ids.other }));
    expect(await recoverInitialPayment(deps, ids.customer, ids.target)).toEqual(
      unavailable,
    );
    expect(db.complete).toHaveBeenCalledOnce();
    expect(deps.toss.charge.query).toHaveBeenCalledOnce();
  });
  it.each(['enrollmentCase', 'read', 'claim'] as const)(
    'redacts %s storage exception without global recovery fallback',
    async (operation) => {
      const { deps, db } = setup();
      const method =
        operation === 'enrollmentCase' ? deps.enrollmentCase : db[operation];
      method.mockRejectedValue(new Error('private failed binding'));
      expect(
        await recoverInitialPayment(deps, ids.customer, ids.target),
      ).toEqual(unavailable);
      expect(db.candidates).not.toHaveBeenCalled();
      expectNoQuery(deps);
    },
  );
});
