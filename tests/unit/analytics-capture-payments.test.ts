// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsEvent } from '@/config/analytics-events';
import {
  observeEnrollment,
  observeRenewal,
  observeReconciliation,
} from '@/server/services/analytics/payment-observations';
import type { EnrollmentDbPort } from '@/server/services/enrollment/model';
import type { RenewalDbPort } from '@/server/services/subscription/renewal-model';
import type { ReconciliationDbPort } from '@/server/services/reconciliation/model';
import { id, actor, row, charge } from './analytics-capture-fixtures';
import {
  reconciliationSnapshot,
  reconciliationIds as ids,
} from './reconciliation-worker-fixtures';
const accepted = { ok: true, data: null } as const;
function capture() {
  return {
    server: vi.fn().mockResolvedValue(accepted),
    charge: vi.fn().mockResolvedValue(accepted),
    cancellation: vi.fn().mockResolvedValue(accepted),
  };
}
function enrollment(data = row()) {
  const result = { ok: true as const, data };
  const port = {
    start: vi.fn().mockResolvedValue(result),
    read: vi.fn(),
    capture: vi.fn(),
    claim: vi.fn(),
    recordReady: vi.fn(),
    recordCredential: vi.fn(),
    recordOutcome: vi.fn().mockResolvedValue(result),
    finalize: vi.fn().mockResolvedValue(result),
    recordReconciliation: vi.fn(),
    cancel: vi.fn(),
  } satisfies EnrollmentDbPort;
  const analytics = capture();
  return {
    port,
    result,
    analytics,
    observed: observeEnrollment(port, analytics),
  };
}
describe('committed payment source observation decorators', () => {
  it('records actual enrollment start using distinct enrollment session key, not reusable subscription ID', async () => {
    const { port, observed, analytics, result } = enrollment();
    expect(
      await observed.start(actor, id(2), 'c'.repeat(64), 'fictional_mid'),
    ).toBe(result);
    expect(port.start).toHaveBeenCalledExactlyOnceWith(
      actor,
      id(2),
      'c'.repeat(64),
      'fictional_mid',
    );
    expect(analytics.server).toHaveBeenCalledExactlyOnceWith(
      {
        actor_id: actor.actorId,
        event: {
          name: AnalyticsEvent.SUBSCRIBE_START,
          event_key: id(2),
          properties: { source_id: id(4) },
        },
      },
      undefined,
    );
    expect(analytics.charge).not.toHaveBeenCalled();
  });
  it.each([{ user_id: id(99) }, { session_id: id(99) }])(
    'does not observe a mismatched enrollment %j',
    async (patch) => {
      const { observed, analytics, result } = enrollment(row(patch));
      expect(
        await observed.start(actor, id(2), 'c'.repeat(64), 'fictional_mid'),
      ).toBe(result);
      expect(analytics.server).not.toHaveBeenCalled();
    },
  );
  it.each(['charge', 'approve'] as const)(
    'records only persisted failed %s attempt with evidence source handle',
    async (stage) => {
      const { observed, analytics } = enrollment(
        row({ state: 'failed', stage }),
      );
      await observed.recordOutcome(
        actor.actorId,
        id(2),
        id(10),
        'failed',
        id(12),
      );
      expect(analytics.server).toHaveBeenCalledExactlyOnceWith(
        {
          actor_id: actor.actorId,
          event: {
            name: AnalyticsEvent.SUBSCRIBE_FAIL,
            event_key: id(8),
            properties: { source_id: id(8) },
          },
        },
        undefined,
      );
    },
  );
  it.each([
    { state: 'unknown' as const, stage: 'charge' as const },
    { state: 'failed' as const, stage: 'exchange' as const },
    { state: 'failed' as const, stage: 'ready' as const },
    { state: 'failed' as const, stage: null },
    { state: 'failed' as const, stage: 'charge' as const, user_id: id(99) },
    { state: 'failed' as const, stage: 'charge' as const, session_id: id(99) },
  ])(
    'does not relabel unknown/credential/mismatched state as charge failure %j',
    async (patch) => {
      const { observed, analytics } = enrollment(row(patch));
      await observed.recordOutcome(
        actor.actorId,
        id(2),
        id(10),
        'failed',
        id(12),
      );
      expect(analytics.server).not.toHaveBeenCalled();
    },
  );
  it('does not record an unknown outcome even if an inconsistent port calls it failed', async () => {
    const { observed, analytics } = enrollment(
      row({ state: 'failed', stage: 'charge' }),
    );
    await observed.recordOutcome(
      actor.actorId,
      id(2),
      id(10),
      'unknown',
      id(12),
    );
    expect(analytics.server).not.toHaveBeenCalled();
  });
  it('passes only verified immutable event ID after initial finalization', async () => {
    const { observed, analytics, result } = enrollment(
      row({ state: 'succeeded', payment_event_id: id(11) }),
    );
    expect(
      await observed.finalize(actor.actorId, id(2), charge, id(12), null),
    ).toBe(result);
    expect(analytics.charge).toHaveBeenCalledExactlyOnceWith(id(11), undefined);
    expect(JSON.stringify(analytics.charge.mock.calls)).not.toContain(
      charge.providerTransactionId,
    );
  });
  it.each([
    { state: 'processing' as const, payment_event_id: id(11) },
    { state: 'succeeded' as const, payment_event_id: null },
    { state: 'succeeded' as const, payment_event_id: id(11), user_id: id(99) },
    {
      state: 'succeeded' as const,
      payment_event_id: id(11),
      session_id: id(99),
    },
  ])(
    'does not classify unconfirmed or mismatched initial charge %j',
    async (patch) => {
      const { observed, analytics } = enrollment(row(patch));
      await observed.finalize(actor.actorId, id(2), charge, id(12), null);
      expect(analytics.charge).not.toHaveBeenCalled();
    },
  );
  it('does not decorate ordinary reads, credential writes, intent cancellation or uncommitted reconciliation evidence', () => {
    const { observed, port } = enrollment();
    for (const name of [
      'read',
      'capture',
      'claim',
      'recordReady',
      'recordCredential',
      'recordReconciliation',
      'cancel',
    ] as const)
      expect(observed[name]).toBe(port[name]);
  });
  it.each([
    'UNAVAILABLE',
    'CONSENT_REQUIRED',
    'FORBIDDEN',
    'IDEMPOTENCY_CONFLICT',
    'SETUP_NOT_READY',
  ])(
    'preserves successful source after optional %s refusal and never retries source',
    async (code) => {
      const { observed, port, analytics, result } = enrollment();
      analytics.server.mockResolvedValue({ ok: false, code });
      expect(
        await observed.start(actor, id(2), 'c'.repeat(64), 'fictional_mid'),
      ).toBe(result);
      expect(port.start).toHaveBeenCalledOnce();
      expect(analytics.server).toHaveBeenCalledOnce();
    },
  );
  it('preserves successful source after optional transport exception', async () => {
    const { observed, analytics, result } = enrollment();
    analytics.server.mockRejectedValue(new Error('offline'));
    expect(
      await observed.start(actor, id(2), 'c'.repeat(64), 'fictional_mid'),
    ).toBe(result);
  });
  it('does not record refused source outcomes and preserves them exactly', async () => {
    const { observed, port, analytics } = enrollment();
    const failed = { ok: false, code: 'UNAVAILABLE' };
    port.start.mockResolvedValue(failed);
    port.finalize.mockResolvedValue(failed);
    port.recordOutcome.mockResolvedValue(failed);
    expect(
      await observed.start(actor, id(2), 'c'.repeat(64), 'fictional_mid'),
    ).toBe(failed);
    expect(
      await observed.finalize(actor.actorId, id(2), charge, id(12), null),
    ).toBe(failed);
    expect(
      await observed.recordOutcome(
        actor.actorId,
        id(2),
        id(10),
        'failed',
        id(12),
      ),
    ).toBe(failed);
    expect(analytics.server).not.toHaveBeenCalled();
    expect(analytics.charge).not.toHaveBeenCalled();
  });
  it('does not turn a source exception into analytics success', async () => {
    const { observed, port, analytics } = enrollment();
    port.start.mockRejectedValue(new Error('unknown source'));
    await expect(
      observed.start(actor, id(2), 'c'.repeat(64), 'fictional_mid'),
    ).rejects.toThrow('unknown source');
    expect(analytics.server).not.toHaveBeenCalled();
  });
  it('records renewal only through verified charge identity and leaves other methods unchanged', async () => {
    const result = { ok: true as const, data: id(11) };
    const port = {
      candidates: vi.fn(),
      read: vi.fn(),
      claim: vi.fn(),
      outcome: vi.fn(),
      queryUnknown: vi.fn(),
      finalize: vi.fn().mockResolvedValue(result),
      readAttempt: vi.fn(),
    } satisfies RenewalDbPort;
    const analytics = capture();
    const observed = observeRenewal(port, analytics);
    analytics.charge.mockRejectedValue(new Error('offline'));
    expect(await observed.finalize(id(8), charge, id(12))).toBe(result);
    expect(port.finalize).toHaveBeenCalledOnce();
    expect(analytics.charge).toHaveBeenCalledExactlyOnceWith(id(11), undefined);
    expect(observed.readAttempt).toBe(port.readAttempt);
    expect(observed.outcome).toBe(port.outcome);
  });
  it.each(['initial', 'renewal'] as const)(
    'records explicit successful %s reconciliation but never raw provider response',
    async (kind) => {
      const result = {
        ok: true as const,
        data: {
          ...reconciliationSnapshot,
          kind,
          state: 'processed' as const,
          payment_event_id: ids.event,
        },
      };
      const port = {
        candidates: vi.fn(),
        read: vi.fn(),
        claim: vi.fn(),
        complete: vi.fn().mockResolvedValue(result),
        defer: vi.fn(),
      } satisfies ReconciliationDbPort;
      const analytics = capture();
      const observed = observeReconciliation(port, analytics);
      const payment = {
        providerTransactionId: 'private',
        providerPaymentId: 'private',
        amountKrw: 1000,
        currency: 'KRW' as const,
        occurredAt: '2026-10-26T00:00:00Z',
      };
      expect(
        await observed.complete(ids.case, ids.lease, payment, ids.evidence),
      ).toBe(result);
      expect(analytics.charge).toHaveBeenCalledExactlyOnceWith(
        ids.event,
        undefined,
      );
      expect(observed.read).toBe(port.read);
    },
  );
  it.each([
    {
      kind: 'refund' as const,
      state: 'processed' as const,
      payment_event_id: ids.event,
    },
    {
      kind: 'initial' as const,
      state: 'retry' as const,
      payment_event_id: ids.event,
    },
    {
      kind: 'renewal' as const,
      state: 'processed' as const,
      payment_event_id: null,
    },
    {
      kind: 'renewal' as const,
      state: 'processed' as const,
      payment_event_id: ids.event,
      id: ids.other,
    },
  ])(
    'does not relabel refunds/unconfirmed/mismatched reconciliation %j',
    async (patch) => {
      const port = {
        candidates: vi.fn(),
        read: vi.fn(),
        claim: vi.fn(),
        complete: vi.fn().mockResolvedValue({
          ok: true,
          data: { ...reconciliationSnapshot, ...patch },
        }),
        defer: vi.fn(),
      } satisfies ReconciliationDbPort;
      const analytics = capture();
      await observeReconciliation(port, analytics).complete(
        ids.case,
        ids.lease,
        {
          providerTransactionId: 'private',
          providerPaymentId: 'private',
          amountKrw: 1000,
          currency: 'KRW',
          occurredAt: '2026-10-26T00:00:00Z',
        },
        ids.evidence,
      );
      expect(analytics.charge).not.toHaveBeenCalled();
    },
  );
});
