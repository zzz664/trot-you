// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createSettlementCalculationPort } from '@/server/db/settlement-calculation';
import type { ActorClient } from '@/server/db/client';
import * as f from './settlement-calculation-fixtures';
function fixture(data: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    rpc,
    port: createSettlementCalculationPort({ rpc } as unknown as ActorClient),
  };
}
it('calls only the read-only snapshot RPC without actor override or source mutations', async () => {
  const p = fixture(f.settlementEnvelope);
  expect(await p.port.read(f.settlementQuery)).toEqual({
    ok: true,
    data: f.settlementEnvelope,
  });
  expect(p.rpc).toHaveBeenCalledExactlyOnceWith(
    'settlement_calculation_input',
    { p_artist_id: f.settlementArtist, p_month: '2026-09-01' },
  );
});
it.each([
  null,
  {},
  { ...f.settlementEnvelope, raw: 'private' },
  {
    ...f.settlementEnvelope,
    input: { ...f.settlementInput, sourceVersion: 9007199254740992 },
  },
  {
    ...f.settlementEnvelope,
    input: {
      ...f.settlementInput,
      policy: { ...f.settlementInput.policy, vatRate: 0.1 },
    },
  },
  {
    ...f.settlementEnvelope,
    input: {
      ...f.settlementInput,
      events: [{ ...f.settlementInput.events[0], amountKrw: 6500 }],
    },
  },
])('rejects malformed, extraneous or lossy JSON %#', async (data) => {
  expect(await fixture(data).port.read(f.settlementQuery)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it.each([
  ['SETTLEMENT_ADMIN_REQUIRED', 'FORBIDDEN'],
  ['SETTLEMENT_MONTH_INVALID', 'INVALID_INPUT'],
  ['SETTLEMENT_MONTH_OPEN', 'MONTH_OPEN'],
  ['SETTLEMENT_POLICY_REQUIRED', 'POLICY_REQUIRED'],
  ['SETTLEMENT_CONFIRMED', 'CONFIRMED'],
  ['SETTLEMENT_FULL_MONTH_CONTRACT_REQUIRED', 'FULL_MONTH_CONTRACT_REQUIRED'],
  ['SETTLEMENT_PARTIAL_WEEK_POLICY_REQUIRED', 'PARTIAL_WEEK_POLICY_REQUIRED'],
  ['SETTLEMENT_ADJUSTMENT_POLICY_REQUIRED', 'ADJUSTMENT_POLICY_REQUIRED'],
  ['SETTLEMENT_NEGATIVE_NET_REQUIRES_POLICY', 'NEGATIVE_NET_REQUIRES_POLICY'],
  ['SETTLEMENT_SOURCE_MISMATCH', 'SOURCE_MISMATCH'],
  ['SETTLEMENT_SOURCE_LIMIT_EXCEEDED', 'SOURCE_LIMIT_EXCEEDED'],
  ['SETTLEMENT_READ_COMMITTED_REQUIRED', 'UNAVAILABLE'],
  ['SETTLEMENT_SOURCE_BUSY', 'UNAVAILABLE'],
  ['__proto__', 'UNAVAILABLE'],
  ['private SQL', 'UNAVAILABLE'],
])('maps exact safe error %s', async (message, code) => {
  expect(
    await fixture(null, { message: message! }).port.read(f.settlementQuery),
  ).toEqual({ ok: false, code });
});
