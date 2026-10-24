// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  chargeDueRenewals,
  type RenewalDependencies,
} from '@/server/services/subscription/charge-due';
import type { RenewalSnapshot } from '@/server/services/subscription/renewal-model';
import {
  RENEWAL_CANDIDATE_LIMIT,
  RENEWAL_LEASE_SECONDS,
} from '@/config/renewal';
const id = (n: number) =>
  `b1800000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ok = <T>(data: T) => ({ ok: true as const, data });
const unavailable = { ok: false as const, code: 'UNAVAILABLE' as const };
const envelope = {
  version: 'fixture',
  iv: 'A'.repeat(16),
  ciphertext: 'QQ',
  tag: 'A'.repeat(22),
};
function snapshot(overrides: Partial<RenewalSnapshot> = {}): RenewalSnapshot {
  return {
    subscription_id: id(1),
    user_id: id(2),
    artist_id: id(3),
    subscription_status: 'active',
    action: 'charge',
    reason: null,
    dispatch: false,
    mandate_id: id(4),
    provider: 'toss',
    environment: 'test',
    merchant_account: 'fixture_mid',
    customer_ref: id(5),
    credential_ciphertext: envelope,
    policy_version: id(6),
    billing_period_calendar: 'utc_monthly_clamped',
    payment_tax_basis: 'taxable_krw',
    episode_started_at: '2026-01-31T12:00:00.000Z',
    amount_krw: 6500,
    period_start: '2026-02-28T12:00:00.000Z',
    period_end: '2026-03-31T12:00:00.000Z',
    attempt_id: null,
    attempt_state: null,
    provider_payment_id: null,
    lease_token: null,
    ...overrides,
  };
}
function setup(overrides: Partial<RenewalSnapshot> = {}) {
  const row = snapshot(overrides);
  const claimed = {
    ...row,
    dispatch: true,
    attempt_id: id(7),
    attempt_state: 'inflight' as const,
    lease_token: id(8),
  };
  const charge = {
    orderId: id(7),
    customerRef: id(5),
    amountKrw: 6500,
    merchantAccount: 'fixture_mid',
    currency: 'KRW' as const,
    providerPaymentId: 'fixture-payment',
    providerTransactionId: 'fixture-action',
    approvedAt: '2026-02-28T12:00:02.000Z',
  };
  const deps = {
    db: {
      candidates: vi.fn().mockResolvedValue(ok([id(1)])),
      read: vi.fn().mockResolvedValue(ok(row)),
      claim: vi.fn().mockResolvedValue(ok(claimed)),
      outcome: vi.fn().mockResolvedValue(ok(null)),
      queryUnknown: vi.fn().mockResolvedValue(ok(null)),
      finalize: vi.fn().mockResolvedValue(ok(id(10))),
      readAttempt: vi
        .fn()
        .mockResolvedValue(
          ok({ attempt_id: id(7), state: 'unknown', payment_event_id: null }),
        ),
    },
    vault: { open: vi.fn().mockReturnValue('fixture-secret'), seal: vi.fn() },
    toss: {
      charge: vi.fn().mockResolvedValue(ok(charge)),
      query: vi.fn().mockResolvedValue(ok(charge)),
    },
    kakao: {
      charge: vi.fn().mockResolvedValue(ok(charge)),
      query: vi.fn().mockResolvedValue(ok(charge)),
    },
    configuration: vi
      .fn()
      .mockReturnValue({ environment: 'test', merchant: 'fixture_mid' }),
    evidenceRef: vi.fn().mockReturnValue(id(9)),
  } satisfies RenewalDependencies;
  return { row, claimed, charge, deps };
}
const unknown = {
  ok: false,
  code: 'OUTCOME_UNKNOWN',
  outcome: 'unknown',
  retryAllowed: false,
};

describe('bounded renewal service', () => {
  it('decrypts exact mandate before atomic claim and charges persisted attempt once', async () => {
    const { deps, row } = setup();
    expect(await chargeDueRenewals(deps)).toEqual(
      ok({
        examined: 1,
        dispatched: 1,
        settled: 1,
        declined: 0,
        unknown: 0,
        manualReview: 0,
        expired: 0,
        skipped: 0,
      }),
    );
    expect(deps.db.candidates).toHaveBeenCalledWith(RENEWAL_CANDIDATE_LIMIT);
    expect(deps.db.claim).toHaveBeenCalledWith(row, RENEWAL_LEASE_SECONDS);
    expect(deps.vault.open).toHaveBeenCalledWith(envelope, {
      actorId: id(2),
      artistId: id(3),
      provider: 'toss_card_billing',
      environment: 'test',
      mandateId: id(4),
      purpose: 'credential',
    });
    expect(deps.toss.charge).toHaveBeenCalledExactlyOnceWith({
      customerRef: id(5),
      orderId: id(7),
      amountKrw: 6500,
      credential: 'fixture-secret',
      idempotencyKey: id(7),
    });
    expect(deps.db.finalize).toHaveBeenCalledOnce();
    expect(deps.kakao.charge).not.toHaveBeenCalled();
    expect(JSON.stringify(await chargeDueRenewals(setup().deps))).not.toContain(
      'fixture-secret',
    );
  });
  it('routes by stored provider, not global preference', async () => {
    const { deps } = setup({ provider: 'kakaopay' });
    expect((await chargeDueRenewals(deps)).ok).toBe(true);
    expect(deps.kakao.charge).toHaveBeenCalledOnce();
    expect(deps.toss.charge).not.toHaveBeenCalled();
  });
  it.each(['none', 'blocked', 'manual_review'] as const)(
    'does not claim or dispatch %s',
    async (action) => {
      const { deps } = setup({ action });
      const result = await chargeDueRenewals(deps);
      expect(result.ok).toBe(true);
      expect(deps.db.claim).not.toHaveBeenCalled();
      expect(deps.toss.charge).not.toHaveBeenCalled();
    },
  );
  it('expires locally even without provider configuration or vault', async () => {
    const { deps, row } = setup({
      action: 'expired',
      subscription_status: 'canceled',
    });
    deps.configuration.mockReturnValue(null as never);
    deps.db.claim.mockResolvedValue(
      ok({ ...row, subscription_status: 'expired' }),
    );
    const result = await chargeDueRenewals({ ...deps, vault: null });
    expect(result).toMatchObject({
      ok: true,
      data: { expired: 1, dispatched: 0 },
    });
    expect(deps.configuration).not.toHaveBeenCalled();
  });
  it('maintains an expired Kakao dispatch lease locally without configured provider or vault', async () => {
    const { deps, row } = setup({
      action: 'lease_expired',
      provider: 'kakaopay',
      attempt_id: id(7),
      attempt_state: 'inflight',
    });
    deps.configuration.mockReturnValue(null as never);
    deps.db.claim.mockResolvedValue(
      ok({
        ...row,
        action: 'manual_review',
        attempt_state: 'unknown',
        subscription_status: 'grace',
      }),
    );
    expect(await chargeDueRenewals({ ...deps, vault: null })).toMatchObject({
      ok: true,
      data: { manualReview: 1, dispatched: 0 },
    });
    expect(deps.configuration).not.toHaveBeenCalled();
    expect(deps.kakao.charge).not.toHaveBeenCalled();
    expect(deps.kakao.query).not.toHaveBeenCalled();
  });
  it.each([
    { environment: 'live', merchant: 'fixture_mid' },
    { environment: 'test', merchant: 'other' },
    null,
  ])('fails preflight configuration closed %#', async (config) => {
    const { deps } = setup();
    deps.configuration.mockReturnValue(config as never);
    expect(await chargeDueRenewals(deps)).toMatchObject({
      ok: true,
      data: { skipped: 1, dispatched: 0 },
    });
    expect(deps.db.claim).not.toHaveBeenCalled();
    expect(deps.vault.open).not.toHaveBeenCalled();
  });
  it.each([
    'missing vault',
    'missing ciphertext',
    'tampered ciphertext',
    'invalid plaintext',
  ])('never claims %s', async (scenario) => {
    const { deps } = setup(
      scenario === 'missing ciphertext' ? { credential_ciphertext: null } : {},
    );
    if (scenario === 'tampered ciphertext')
      deps.vault.open.mockImplementation(() => {
        throw new Error('secret');
      });
    if (scenario === 'invalid plaintext')
      deps.vault.open.mockReturnValue('bad\nkey');
    const result = await chargeDueRenewals(
      scenario === 'missing vault' ? { ...deps, vault: null } : deps,
    );
    expect(result).toMatchObject({ ok: true, data: { skipped: 1 } });
    expect(deps.db.claim).not.toHaveBeenCalled();
  });
  it.each([
    'mandate_id',
    'customer_ref',
    'amount_krw',
    'period_start',
    'period_end',
    'episode_started_at',
    'billing_period_calendar',
    'payment_tax_basis',
  ] as const)('rejects missing immutable %s', async (field) => {
    const { deps } = setup({ [field]: null });
    expect(await chargeDueRenewals(deps)).toEqual(unavailable);
    expect(deps.db.claim).not.toHaveBeenCalled();
  });
  it('rejects drifting and overlapping billing periods', async () => {
    const { deps } = setup({ period_end: '2026-03-28T12:00:00.000Z' });
    expect(await chargeDueRenewals(deps)).toEqual(unavailable);
    expect(deps.db.claim).not.toHaveBeenCalled();
  });
  it('a competing worker or cancellation cannot dispatch a nonfresh claim', async () => {
    const { deps, row } = setup();
    deps.db.claim.mockResolvedValue(
      ok({ ...row, action: 'none', subscription_status: 'canceled' }),
    );
    expect(await chargeDueRenewals(deps)).toMatchObject({
      ok: true,
      data: { skipped: 1, dispatched: 0 },
    });
    expect(deps.toss.charge).not.toHaveBeenCalled();
  });
  it.each([
    'mandate_id',
    'user_id',
    'artist_id',
    'customer_ref',
    'policy_version',
  ] as const)('refuses a stale claim changing %s', async (field) => {
    const { deps, claimed } = setup();
    deps.db.claim.mockResolvedValue(ok({ ...claimed, [field]: id(99) }));
    expect(await chargeDueRenewals(deps)).toEqual(unavailable);
    expect(deps.toss.charge).not.toHaveBeenCalled();
  });
  it('revalidates configuration after claim', async () => {
    const { deps } = setup();
    deps.configuration
      .mockReturnValueOnce({ environment: 'test', merchant: 'fixture_mid' })
      .mockReturnValueOnce(null as never);
    expect(await chargeDueRenewals(deps)).toEqual(unavailable);
    expect(deps.toss.charge).not.toHaveBeenCalled();
  });
  it.each(['retryable', 'customer_action', undefined])(
    'records only definitive failure with %s policy permission',
    async (failureDisposition) => {
      const { deps } = setup();
      deps.toss.charge.mockResolvedValue({
        ok: false,
        code: 'PROVIDER_REJECTED',
        outcome: 'rejected',
        retryAllowed: false,
        failureDisposition,
      });
      expect(await chargeDueRenewals(deps)).toMatchObject({
        ok: true,
        data: { declined: 1, settled: 0 },
      });
      expect(deps.db.outcome).toHaveBeenCalledExactlyOnceWith(
        id(7),
        id(8),
        'failed',
        id(9),
        failureDisposition === 'retryable',
      );
      expect(deps.db.finalize).not.toHaveBeenCalled();
    },
  );
  it.each([
    unknown,
    { ...unknown, code: 'CONFIGURATION_INVALID', outcome: 'not_started' },
    { ...unknown, code: 'PROVIDER_REJECTED', outcome: 'unknown' },
  ])('does not confuse unproved outcome %# with failure', async (result) => {
    const { deps } = setup();
    deps.toss.charge.mockResolvedValue(result);
    expect(await chargeDueRenewals(deps)).toMatchObject({
      ok: true,
      data: { unknown: 1, declined: 0, settled: 0 },
    });
    expect(deps.db.outcome).toHaveBeenCalledExactlyOnceWith(
      id(7),
      id(8),
      'unknown',
      id(9),
      false,
    );
  });
  it('transport throws cannot escape secrets or cause retry', async () => {
    const { deps } = setup();
    deps.toss.charge.mockRejectedValue(new Error('secret body'));
    const result = await chargeDueRenewals(deps);
    expect(result).toMatchObject({ ok: true, data: { unknown: 1 } });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(deps.toss.charge).toHaveBeenCalledOnce();
  });
  it.each([
    { amountKrw: 1000 },
    { orderId: id(99) },
    { customerRef: id(99) },
    { merchantAccount: 'other' },
    { currency: 'USD' },
    { approvedAt: 'not a date' },
    { providerPaymentId: 'bad\nsecret' },
    { providerTransactionId: '' },
  ])('does not settle mismatched verified facts %#', async (patch) => {
    const { deps, charge } = setup();
    deps.toss.charge.mockResolvedValue(ok({ ...charge, ...patch }));
    expect(await chargeDueRenewals(deps)).toMatchObject({
      ok: true,
      data: { unknown: 1 },
    });
    expect(deps.db.finalize).not.toHaveBeenCalled();
  });
  it('Toss unknown queries original order without vault or new charge', async () => {
    const { deps } = setup({
      action: 'reconcile',
      attempt_id: id(7),
      attempt_state: 'unknown',
    });
    expect(await chargeDueRenewals({ ...deps, vault: null })).toMatchObject({
      ok: true,
      data: { settled: 1 },
    });
    expect(deps.toss.query).toHaveBeenCalledExactlyOnceWith({
      customerRef: id(5),
      orderId: id(7),
      amountKrw: 6500,
    });
    expect(deps.toss.charge).not.toHaveBeenCalled();
    expect(deps.vault.open).not.toHaveBeenCalled();
  });
  it('Kakao unknown without TID is manual review, not SID status or charge', async () => {
    const { deps } = setup({
      action: 'reconcile',
      provider: 'kakaopay',
      attempt_id: id(7),
      attempt_state: 'unknown',
    });
    expect(await chargeDueRenewals(deps)).toMatchObject({
      ok: true,
      data: { manualReview: 1, dispatched: 0 },
    });
    expect(deps.db.claim).not.toHaveBeenCalled();
    expect(deps.kakao.query).not.toHaveBeenCalled();
    expect(deps.kakao.charge).not.toHaveBeenCalled();
  });
  it('rejects a changed unknown attempt before reconciliation query', async () => {
    const { deps, claimed } = setup({
      action: 'reconcile',
      attempt_id: id(7),
      attempt_state: 'unknown',
    });
    deps.db.claim.mockResolvedValue(ok({ ...claimed, attempt_id: id(99) }));
    expect(await chargeDueRenewals(deps)).toEqual(unavailable);
    expect(deps.toss.query).not.toHaveBeenCalled();
  });
  it('known Kakao TID query remains bound', async () => {
    const { deps } = setup({
      action: 'reconcile',
      provider: 'kakaopay',
      attempt_id: id(7),
      attempt_state: 'unknown',
      provider_payment_id: 'known-tid',
    });
    expect((await chargeDueRenewals(deps)).ok).toBe(true);
    expect(deps.kakao.query).toHaveBeenCalledExactlyOnceWith({
      customerRef: id(5),
      orderId: id(7),
      amountKrw: 6500,
      providerPaymentId: 'known-tid',
    });
  });
  it.each([
    unknown,
    {
      ok: false,
      code: 'PROVIDER_REJECTED',
      outcome: 'rejected',
      retryAllowed: false,
      failureDisposition: 'retryable',
    },
  ])('query failure %# never authorizes retry', async (result) => {
    const { deps } = setup({
      action: 'reconcile',
      attempt_id: id(7),
      attempt_state: 'unknown',
    });
    deps.toss.query.mockResolvedValue(result);
    expect(await chargeDueRenewals(deps)).toMatchObject({
      ok: true,
      data: { unknown: 1 },
    });
    expect(deps.db.queryUnknown).toHaveBeenCalledWith(id(7), id(8));
    expect(deps.db.outcome).not.toHaveBeenCalled();
  });
  it('observes committed finalization after a lost DB response', async () => {
    const { deps } = setup();
    deps.db.finalize.mockResolvedValueOnce(unavailable);
    deps.db.readAttempt.mockResolvedValue(
      ok({ attempt_id: id(7), state: 'success', payment_event_id: id(10) }),
    );
    expect(await chargeDueRenewals(deps)).toMatchObject({
      ok: true,
      data: { settled: 1 },
    });
    expect(deps.db.finalize).toHaveBeenCalledOnce();
    expect(deps.toss.charge).toHaveBeenCalledOnce();
  });
  it('replays identical DB finalization once, not provider charge', async () => {
    const { deps } = setup();
    deps.db.finalize.mockResolvedValueOnce(unavailable);
    expect(await chargeDueRenewals(deps)).toMatchObject({
      ok: true,
      data: { settled: 1 },
    });
    expect(deps.db.finalize).toHaveBeenCalledTimes(2);
    expect(deps.db.finalize.mock.calls[0]).toEqual(
      deps.db.finalize.mock.calls[1],
    );
    expect(deps.toss.charge).toHaveBeenCalledOnce();
  });
  it.each([
    'read fails',
    'read wrong attempt',
    'second save fails',
    'impossible state',
  ])('lost result %s remains unavailable', async (scenario) => {
    const { deps } = setup();
    deps.db.finalize.mockResolvedValue(unavailable);
    if (scenario === 'read fails')
      deps.db.readAttempt.mockResolvedValue(unavailable);
    if (scenario === 'read wrong attempt')
      deps.db.readAttempt.mockResolvedValue(
        ok({ attempt_id: id(99), state: 'success', payment_event_id: id(10) }),
      );
    if (scenario === 'impossible state')
      deps.db.readAttempt.mockResolvedValue(
        ok({ attempt_id: id(7), state: 'failed', payment_event_id: null }),
      );
    expect(await chargeDueRenewals(deps)).toEqual(unavailable);
    expect(deps.toss.charge).toHaveBeenCalledOnce();
    expect(deps.db.finalize.mock.calls.length).toBeLessThanOrEqual(2);
  });
  it.each([
    'candidates',
    'read',
    'claim',
    'outcome',
    'finalize',
    'queryUnknown',
  ] as const)('sanitizes %s DB failure', async (stage) => {
    const { deps } = setup(
      stage === 'queryUnknown'
        ? { action: 'reconcile', attempt_id: id(7) }
        : {},
    );
    if (stage === 'outcome') deps.toss.charge.mockResolvedValue(unknown);
    if (stage === 'queryUnknown') deps.toss.query.mockResolvedValue(unknown);
    deps.db[stage].mockResolvedValue(unavailable);
    expect(await chargeDueRenewals(deps)).toEqual(unavailable);
  });
  it.each([
    [id(1), id(1)],
    ['invalid'],
    Array.from({ length: 5 }, (_, i) => id(i + 1)),
  ])('rejects invalid/unbounded candidates %#', async (ids) => {
    const { deps } = setup();
    deps.db.candidates.mockResolvedValue(ok(ids));
    expect(await chargeDueRenewals(deps)).toEqual(unavailable);
    expect(deps.db.read).not.toHaveBeenCalled();
  });
  it('hard limits provider work to one even with multiple eligible subscriptions', async () => {
    const { deps } = setup();
    deps.db.candidates.mockResolvedValue(ok([id(1), id(11), id(12), id(13)]));
    expect(await chargeDueRenewals(deps)).toMatchObject({
      ok: true,
      data: { examined: 1, dispatched: 1 },
    });
    expect(deps.db.read).toHaveBeenCalledOnce();
  });
  it('empty batch is a truthful no-op', async () => {
    const { deps } = setup();
    deps.db.candidates.mockResolvedValue(ok([]));
    expect(await chargeDueRenewals(deps)).toMatchObject({
      ok: true,
      data: { examined: 0, dispatched: 0, settled: 0 },
    });
  });
});
