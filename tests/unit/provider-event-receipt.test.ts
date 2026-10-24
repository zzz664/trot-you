// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { receiveTossEvent } from '@/server/services/reconciliation/receive';
import { createProviderReceiptPort } from '@/server/db/provider-events';
import type { UntrustedTossProviderEvent } from '@/server/adapters/payment/provider-events';
import type { CheckoutServiceClient } from '@/server/db/checkout-client';
import { reconciliationIds as ids } from './reconciliation-worker-fixtures';
const unavailable = { ok: false, code: 'UNAVAILABLE' };
const event: UntrustedTossProviderEvent = {
  provider: 'toss',
  trust: 'unverified',
  eventType: 'PAYMENT_STATUS_CHANGED',
  transmissionId: 'fictional-transmission',
  semanticKey: 'a'.repeat(64),
  orderId: ids.target,
  providerPaymentId: 'fictional-payment',
  providerTransactionId: 'fictional-action',
  merchantAccount: 'fictional-mid',
  status: 'DONE',
  totalAmountKrw: 1000,
  balanceAmountKrw: 1000,
  createdAt: '2026-10-24T12:00:00',
};
function setupReceipt(
  data: unknown = { accepted: true, duplicate: false },
  error: unknown = null,
) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  const from = vi.fn(() => {
    throw new Error('Direct SQL forbidden');
  });
  return {
    rpc,
    from,
    db: createProviderReceiptPort({
      rpc,
      from,
    } as unknown as CheckoutServiceClient),
  };
}
function setupService(data: unknown = { accepted: true, duplicate: false }) {
  const db = { receive: vi.fn().mockResolvedValue({ ok: true, data }) };
  return { db, environment: 'test' as const, merchant: 'fictional-mid' };
}
describe('untrusted provider receipt service', () => {
  it('records an advisory notice only with server-configured environment', async () => {
    const deps = setupService();
    expect(await receiveTossEvent(deps, event)).toEqual({
      ok: true,
      data: null,
    });
    expect(deps.db.receive).toHaveBeenCalledExactlyOnceWith('test', event);
    expect(Object.keys(deps.db)).toEqual(['receive']);
  });
  it.each([
    { accepted: true, duplicate: false },
    { accepted: true, duplicate: true },
    { accepted: false, duplicate: false },
  ])('does not reveal known/unknown/duplicate identity %j', async (result) => {
    expect(await receiveTossEvent(setupService(result), event)).toEqual({
      ok: true,
      data: null,
    });
  });
  it('acknowledges unrelated merchant without creating storage or an identity oracle', async () => {
    const deps = setupService();
    expect(
      await receiveTossEvent(deps, {
        ...event,
        merchantAccount: 'another-merchant',
      }),
    ).toEqual({ ok: true, data: null });
    expect(deps.db.receive).not.toHaveBeenCalled();
  });
  it.each([{ trust: 'verified' }, { provider: 'kakaopay' }])(
    'never promotes unsupported trust/provider %j',
    async (patch) => {
      const deps = setupService();
      expect(
        await receiveTossEvent(deps, {
          ...event,
          ...patch,
        } as UntrustedTossProviderEvent),
      ).toEqual(unavailable);
      expect(deps.db.receive).not.toHaveBeenCalled();
    },
  );
  it('requests delivery retry only on durable receipt failure without logging raw details', async () => {
    const deps = setupService();
    deps.db.receive.mockResolvedValue(unavailable);
    expect(await receiveTossEvent(deps, event)).toEqual(unavailable);
    deps.db.receive.mockRejectedValue(new Error('private provider body'));
    expect(await receiveTossEvent(deps, event)).toEqual(unavailable);
  });
});
describe('bounded private provider receipt DB adapter', () => {
  it('persists allowlisted hint fields only, never transmission/timestamp/PII/raw financial evidence', async () => {
    const { db, rpc, from } = setupReceipt();
    expect(
      await db.receive('test', {
        ...event,
        ...{ raw: { customerName: 'secret-name', billingKey: 'secret-key' } },
      }),
    ).toEqual({ ok: true, data: { accepted: true, duplicate: false } });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('reconciliation_receive_toss', {
      p_environment: 'test',
      p_merchant_account: 'fictional-mid',
      p_order_id: ids.target,
      p_payment_id: 'fictional-payment',
      p_status: 'DONE',
      p_amount_krw: 1000,
      p_payload_digest: 'a'.repeat(64),
    });
    const saved = JSON.stringify(rpc.mock.calls);
    for (const secret of [
      'secret-name',
      'secret-key',
      event.transmissionId,
      event.createdAt,
      event.providerTransactionId,
    ])
      expect(saved).not.toContain(secret);
    expect(from).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    {},
    { accepted: 'true', duplicate: false },
    { accepted: true, duplicate: 1 },
    { accepted: true, duplicate: false, secret: 'private' },
  ])('rejects malformed receipt result %j', async (data) => {
    expect(await setupReceipt(data).db.receive('test', event)).toEqual(
      unavailable,
    );
  });
  it.each([
    { message: 'FORBIDDEN' },
    { message: 'private provider body' },
    'network error',
  ])('redacts database failure %j', async (error) => {
    expect(
      await setupReceipt(undefined, error).db.receive('test', event),
    ).toEqual(unavailable);
  });
});
