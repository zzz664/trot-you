// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { previewSettlement } from '@/server/services/settlement/read';
import { calculateSettlement } from '@/server/services/settlement/calculate';
import * as f from './settlement-calculation-fixtures';

it('reads an actor-bound approved snapshot and returns only the pure calculation', async () => {
  const read = vi
    .fn()
    .mockResolvedValue({ ok: true, data: f.settlementEnvelope });
  const result = await previewSettlement(
    { read },
    f.settlementQuery,
    f.settlementActor,
  );
  expect(result).toEqual(calculateSettlement(f.settlementInput));
  expect(result.ok).toBe(true);
  expect(read).toHaveBeenCalledExactlyOnceWith(f.settlementQuery);
});
it.each([
  null,
  {},
  [],
  { ...f.settlementQuery, month: '2026-09-02' },
  { ...f.settlementQuery, artistId: 'bad' },
  { ...f.settlementQuery, enabled: true },
  { ...f.settlementQuery, actorId: f.settlementActor },
])('invalid/forged query skips database %#', async (input) => {
  const read = vi.fn();
  expect(await previewSettlement({ read }, input, f.settlementActor)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(read).not.toHaveBeenCalled();
});
it('invalid actor skips database', async () => {
  const read = vi.fn();
  expect(await previewSettlement({ read }, f.settlementQuery, 'bad')).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(read).not.toHaveBeenCalled();
});
it.each([
  null,
  {},
  { ...f.settlementEnvelope, actorId: f.settlementOther },
  {
    ...f.settlementEnvelope,
    input: { ...f.settlementInput, artistId: f.settlementOther },
  },
  {
    ...f.settlementEnvelope,
    input: { ...f.settlementInput, month: '2026-08-01' },
  },
  { ...f.settlementEnvelope, subscriberCount: 1 },
  { ...f.settlementEnvelope, input: { ...f.settlementInput, policy: null } },
  {
    ...f.settlementEnvelope,
    input: {
      ...f.settlementInput,
      events: [{ ...f.settlementInput.events[0], verified: false }],
    },
  },
])(
  'rejects cross-actor/range, malformed or extraneous response %#',
  async (data) => {
    const read = vi.fn().mockResolvedValue({ ok: true, data });
    expect(
      await previewSettlement({ read }, f.settlementQuery, f.settlementActor),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  },
);
it('preserves truthful policy unavailable without documented-rate fallback', async () => {
  const read = vi
    .fn()
    .mockResolvedValue({ ok: false, code: 'POLICY_REQUIRED' });
  expect(
    await previewSettlement({ read }, f.settlementQuery, f.settlementActor),
  ).toEqual({ ok: false, code: 'POLICY_REQUIRED' });
});
it('does not retain a preview between separate reads or hide revocation', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, data: f.settlementEnvelope })
    .mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
  expect(
    (await previewSettlement({ read }, f.settlementQuery, f.settlementActor))
      .ok,
  ).toBe(true);
  expect(
    await previewSettlement({ read }, f.settlementQuery, f.settlementActor),
  ).toEqual({ ok: false, code: 'FORBIDDEN' });
  expect(read).toHaveBeenCalledTimes(2);
});
it('hides thrown SQL/source details rather than returning a success', async () => {
  const read = vi
    .fn()
    .mockRejectedValue(new Error('private SQL and payment details'));
  expect(
    await previewSettlement({ read }, f.settlementQuery, f.settlementActor),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('keeps calculator policy errors fail-closed', async () => {
  const data = {
    ...f.settlementEnvelope,
    input: { ...f.settlementInput, asOf: '2026-09-15T00:00:00Z' },
  };
  const read = vi.fn().mockResolvedValue({ ok: true, data });
  expect(
    await previewSettlement({ read }, f.settlementQuery, f.settlementActor),
  ).toEqual({ ok: false, code: 'MONTH_OPEN' });
});
