// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { CheckoutServiceClient } from '@/server/db/checkout-client';
import { createRenewalDbPort } from '@/server/db/renewal';
import type { RenewalSnapshot } from '@/server/services/subscription/renewal-model';
const id = (n: number) =>
  `b1810000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const snapshot: RenewalSnapshot = {
  subscription_id: id(1),
  user_id: id(2),
  artist_id: id(3),
  subscription_status: 'expired',
  action: 'expired',
  reason: null,
  dispatch: false,
  mandate_id: null,
  provider: 'toss',
  environment: null,
  merchant_account: null,
  customer_ref: null,
  credential_ciphertext: null,
  policy_version: null,
  billing_period_calendar: null,
  payment_tax_basis: null,
  episode_started_at: null,
  amount_krw: null,
  period_start: null,
  period_end: null,
  attempt_id: null,
  attempt_state: null,
  provider_payment_id: null,
  lease_token: null,
};
const charge = {
  customerRef: id(2),
  orderId: id(3),
  amountKrw: 6500,
  merchantAccount: 'fixture',
  currency: 'KRW' as const,
  providerPaymentId: 'payment',
  providerTransactionId: 'action',
  approvedAt: '2026-10-24T12:00:00.000Z',
};
function setup(data: unknown = null, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    rpc,
    port: createRenewalDbPort({ rpc } as unknown as CheckoutServiceClient),
  };
}
describe('renewal DB boundary', () => {
  it('validates candidate UUIDs and limits', async () => {
    const { port, rpc } = setup([id(1)]);
    expect(await port.candidates(4)).toEqual({ ok: true, data: [id(1)] });
    expect(rpc).toHaveBeenCalledWith('renewal_candidates', { p_limit: 4 });
  });
  it.each([null, {}, ['bad'], Array.from({ length: 5 }, (_, i) => id(i + 1))])(
    'rejects candidate payload %#',
    async (data) => {
      expect(await setup(data).port.candidates(4)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
  it('reads only private typed snapshot without public projection', async () => {
    const { port, rpc } = setup(snapshot);
    expect(await port.read(id(1))).toEqual({ ok: true, data: snapshot });
    expect(rpc).toHaveBeenCalledWith('renewal_read', {
      p_subscription_id: id(1),
    });
  });
  it('omits nullable expiry claim parameters for genuine generated RPC signatures', async () => {
    const { port, rpc } = setup(snapshot);
    expect((await port.claim(snapshot, 120)).ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('renewal_claim', {
      p_subscription_id: id(1),
      p_lease_seconds: 120,
    });
  });
  it('binds due snapshot on claim', async () => {
    const row = {
      ...snapshot,
      mandate_id: id(4),
      period_start: '2026-10-24T12:00:00Z',
      period_end: '2026-11-24T12:00:00Z',
    };
    const { port, rpc } = setup(row);
    await port.claim(row, 120);
    expect(rpc).toHaveBeenCalledWith('renewal_claim', {
      p_subscription_id: id(1),
      p_lease_seconds: 120,
      p_mandate_id: id(4),
      p_period_start: row.period_start,
      p_period_end: row.period_end,
    });
  });
  it('writes only safe normalized outcome', async () => {
    const { port, rpc } = setup();
    expect(await port.outcome(id(1), id(2), 'failed', id(3), true)).toEqual({
      ok: true,
      data: null,
    });
    expect(rpc).toHaveBeenCalledWith('renewal_record_outcome', {
      p_attempt_id: id(1),
      p_lease_token: id(2),
      p_outcome: 'failed',
      p_evidence_ref: id(3),
      p_retryable: true,
    });
  });
  it('releases only the acquired query lease', async () => {
    const { port, rpc } = setup();
    await port.queryUnknown(id(1), id(2));
    expect(rpc).toHaveBeenCalledWith('renewal_record_query', {
      p_attempt_id: id(1),
      p_lease_token: id(2),
    });
  });
  it('finalizes verified facts with stable evidence but no raw/credential body', async () => {
    const { port, rpc } = setup(id(9));
    expect(await port.finalize(id(1), charge, id(8))).toEqual({
      ok: true,
      data: id(9),
    });
    expect(rpc).toHaveBeenCalledWith('renewal_finalize', {
      p_attempt_id: id(1),
      p_provider_action_id: 'action',
      p_provider_payment_id: 'payment',
      p_amount_krw: 6500,
      p_currency: 'KRW',
      p_approved_at: charge.approvedAt,
      p_evidence_ref: id(8),
    });
  });
  it('reads durable state for one safe persistence retry', async () => {
    const { port, rpc } = setup({
      attempt_id: id(1),
      state: 'success',
      payment_event_id: id(2),
    });
    expect((await port.readAttempt(id(1))).ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('renewal_read_attempt', {
      p_attempt_id: id(1),
    });
  });
  it.each([
    'candidates',
    'read',
    'claim',
    'outcome',
    'queryUnknown',
    'finalize',
    'readAttempt',
  ] as const)('sanitizes %s SQL errors', async (operation) => {
    const { port } = setup(null, {
      message: 'PRIVATE_POSTGRES_SECRET',
      details: 'PRIVATE_VALUE',
    });
    let result;
    if (operation === 'candidates') result = await port.candidates(4);
    else if (operation === 'read') result = await port.read(id(1));
    else if (operation === 'claim') result = await port.claim(snapshot, 120);
    else if (operation === 'outcome')
      result = await port.outcome(id(1), id(2), 'unknown', id(3), false);
    else if (operation === 'queryUnknown')
      result = await port.queryUnknown(id(1), id(2));
    else if (operation === 'finalize')
      result = await port.finalize(id(1), charge, id(3));
    else result = await port.readAttempt(id(1));
    expect(result).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it.each([
    { ...snapshot, action: 'fake_success' },
    { ...snapshot, credential_ciphertext: { secret: 'raw' } },
    { ...snapshot, amount_krw: -1 },
    { ...snapshot, attempt_state: 'succeeded' },
  ])('rejects malformed snapshot %#', async (data) => {
    expect(await setup(data).port.read(id(1))).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});
