// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRenewalDependencies } from '@/server/renewal/dependencies';
const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  client: vi.fn(),
  transport: vi.fn(),
  db: vi.fn(),
  vault: vi.fn(),
  toss: vi.fn(),
  kakao: vi.fn(),
  config: vi.fn(),
}));
vi.mock('@/config/env.server', () => ({ getServerEnv: mocks.env }));
vi.mock('@/server/db/checkout-client', () => ({
  createCheckoutServiceClient: mocks.client,
}));
vi.mock('@/server/db/renewal', () => ({ createRenewalDbPort: mocks.db }));
vi.mock('@/server/adapters/payment/ci-transport', () => ({
  createEnrollmentTransport: mocks.transport,
}));
vi.mock('@/server/adapters/payment/vault', () => ({
  createPaymentVault: mocks.vault,
}));
vi.mock('@/server/adapters/payment/renewal-toss', () => ({
  createTossRenewalAdapter: mocks.toss,
}));
vi.mock('@/server/adapters/payment/renewal-kakaopay', () => ({
  createKakaoRenewalAdapter: mocks.kakao,
}));
vi.mock('@/server/configuration', () => ({
  requireIntegrationConfiguration: mocks.config,
}));
const env = {
  PAYMENTS_RENEWALS_ENABLED: true,
  TOSS_BILLING_MID: 'fixture-mid',
  KAKAOPAY_RECURRING_CID: 'fixture-cid',
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.mockReturnValue({ ok: true, data: env });
  mocks.client.mockReturnValue({ client: true });
  mocks.transport.mockReturnValue(vi.fn());
  mocks.db.mockReturnValue({ db: true });
  mocks.vault.mockReturnValue({ vault: true });
  mocks.toss.mockReturnValue({ toss: true });
  mocks.kakao.mockReturnValue({ kakao: true });
  mocks.config.mockReturnValue({ ok: true, data: { mode: 'test' } });
});
describe('renewal dependency boundary', () => {
  it.each([
    { ok: false, code: 'CONFIGURATION_INVALID' },
    { ok: true, data: { PAYMENTS_RENEWALS_ENABLED: false } },
  ])(
    'rejects disabled/invalid environment %# before client construction',
    (parsed) => {
      mocks.env.mockReturnValue(parsed);
      expect(createRenewalDependencies()).toBeNull();
      expect(mocks.client).not.toHaveBeenCalled();
      expect(mocks.toss).not.toHaveBeenCalled();
    },
  );
  it.each(['client', 'transport'] as const)('rejects missing %s', (name) => {
    mocks[name].mockReturnValue(null);
    expect(createRenewalDependencies()).toBeNull();
    expect(mocks.toss).not.toHaveBeenCalled();
  });
  it('injects guarded transport into both real adapters without dispatch', () => {
    const deps = createRenewalDependencies()!;
    expect(deps.db).toEqual({ db: true });
    expect(mocks.toss).toHaveBeenCalledExactlyOnceWith(
      env,
      mocks.transport.mock.results[0]!.value,
    );
    expect(mocks.kakao).toHaveBeenCalledExactlyOnceWith(
      env,
      mocks.transport.mock.results[0]!.value,
    );
    expect(deps.evidenceRef()).toMatch(/^[0-9a-f-]{36}$/);
    expect(deps.evidenceRef()).not.toBe(deps.evidenceRef());
  });
  it('allows expiry and query without a vault but never fabricates one', () => {
    mocks.vault.mockReturnValue(null);
    expect(createRenewalDependencies()?.vault).toBeNull();
  });
  it.each(['toss_card_billing', 'kakaopay_subscription'] as const)(
    'projects exact configured merchant and environment for %s',
    (provider) => {
      const deps = createRenewalDependencies()!;
      expect(deps.configuration(provider)).toEqual({
        environment: 'test',
        merchant:
          provider === 'toss_card_billing' ? 'fixture-mid' : 'fixture-cid',
      });
      expect(mocks.config).toHaveBeenCalledWith(provider, {
        ok: true,
        data: env,
      });
    },
  );
  it.each([
    { ok: false, error: { code: 'INTEGRATION_UNAVAILABLE' } },
    { ok: true, data: { mode: 'disabled' } },
  ])('does not fabricate configuration %#', (value) => {
    mocks.config.mockReturnValue(value);
    expect(
      createRenewalDependencies()?.configuration('toss_card_billing'),
    ).toBeNull();
  });
  it('rejects missing merchant identity even if an upstream readiness projection is inconsistent', () => {
    mocks.env.mockReturnValue({
      ok: true,
      data: { PAYMENTS_RENEWALS_ENABLED: true },
    });
    expect(
      createRenewalDependencies()?.configuration('kakaopay_subscription'),
    ).toBeNull();
  });
});
