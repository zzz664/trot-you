// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReconciliationDependencies } from '@/server/reconciliation/dependencies';
import { createProviderReceiptDependencies } from '@/server/provider-events/dependencies';
import { createInitialPaymentRecovery } from '@/server/reconciliation/enrollment';
import { RECONCILIATION_RECEIPT_TIMEOUT_MS } from '@/config/reconciliation';
import type { ServerEnv } from '@/config/env.server';
import type { CheckoutServiceClient } from '@/server/db/checkout-client';
const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  client: vi.fn(),
  chargeTransport: vi.fn(),
  refundTransport: vi.fn(),
  db: vi.fn(),
  receipt: vi.fn(),
  cases: vi.fn(),
  toss: vi.fn(),
  kakao: vi.fn(),
  tossRefund: vi.fn(),
  kakaoRefund: vi.fn(),
  config: vi.fn(),
  initial: vi.fn(),
}));
vi.mock('@/config/env.server', () => ({ getServerEnv: mocks.env }));
vi.mock('@/server/db/checkout-client', () => ({
  createCheckoutServiceClient: mocks.client,
}));
vi.mock('@/server/db/reconciliation', () => ({
  createReconciliationDbPort: mocks.db,
  createEnrollmentReconciliationCasePort: mocks.cases,
}));
vi.mock('@/server/db/provider-events', () => ({
  createProviderReceiptPort: mocks.receipt,
}));
vi.mock('@/server/adapters/payment/ci-transport', () => ({
  createEnrollmentTransport: mocks.chargeTransport,
}));
vi.mock('@/server/adapters/payment/refund-ci-transport', () => ({
  createRefundTransport: mocks.refundTransport,
}));
vi.mock('@/server/adapters/payment/renewal-toss', () => ({
  createTossRenewalAdapter: mocks.toss,
}));
vi.mock('@/server/adapters/payment/renewal-kakaopay', () => ({
  createKakaoRenewalAdapter: mocks.kakao,
}));
vi.mock('@/server/adapters/payment/refund-toss', () => ({
  createTossRefundAdapter: mocks.tossRefund,
}));
vi.mock('@/server/adapters/payment/refund-kakaopay', () => ({
  createKakaoRefundAdapter: mocks.kakaoRefund,
}));
vi.mock('@/server/configuration', () => ({
  requireIntegrationConfiguration: mocks.config,
}));
vi.mock('@/server/services/reconciliation/initial', () => ({
  recoverInitialPayment: mocks.initial,
}));
const env = {
  PAYMENTS_RECONCILIATION_ENABLED: true,
  TOSS_BILLING_MID: 'fixture-mid',
  KAKAOPAY_RECURRING_CID: 'fixture-cid',
};
const client = { fixture: true } as unknown as CheckoutServiceClient;
const transport = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.mockReturnValue({ ok: true, data: env });
  mocks.client.mockReturnValue(client);
  mocks.chargeTransport.mockReturnValue(transport);
  mocks.refundTransport.mockReturnValue(transport);
  mocks.db.mockReturnValue({ private: true });
  mocks.cases.mockReturnValue({ enrollmentCase: vi.fn() });
  mocks.receipt.mockReturnValue({ privateReceipt: true });
  for (const key of ['toss', 'kakao', 'tossRefund', 'kakaoRefund'] as const)
    mocks[key].mockReturnValue({
      charge: vi.fn(),
      refund: vi.fn(),
      query: vi.fn(),
    });
  mocks.config.mockReturnValue({
    ok: true,
    data: { mode: 'test', credentials: { TOSS_BILLING_MID: 'fixture-mid' } },
  });
  mocks.initial.mockResolvedValue({ ok: true, data: null });
});
describe('query-only composition boundary', () => {
  it.each([
    { ok: false },
    { ok: true, data: {} },
    { ok: true, data: { PAYMENTS_RECONCILIATION_ENABLED: false } },
  ])('disabled config %# constructs no private capability', (parsed) => {
    mocks.env.mockReturnValue(parsed);
    expect(createReconciliationDependencies()).toBeNull();
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.toss).not.toHaveBeenCalled();
  });
  it.each(['client', 'chargeTransport', 'refundTransport'] as const)(
    'missing%s fails closed',
    (name) => {
      mocks[name].mockReturnValue(null);
      expect(createReconciliationDependencies()).toBeNull();
      expect(mocks.toss).not.toHaveBeenCalled();
    },
  );
  it('strips all mutation/vault capabilities at runtime and injects guarded real adapters', () => {
    const deps = createReconciliationDependencies()!;
    for (const provider of [deps.toss, deps.kakao]) {
      expect(Object.keys(provider.charge)).toEqual(['query']);
      expect(Object.keys(provider.refund)).toEqual(['query']);
    }
    expect(deps).not.toHaveProperty('vault');
    expect(mocks.toss).toHaveBeenCalledWith(env, transport);
    expect(mocks.kakaoRefund).toHaveBeenCalledWith(env, transport);
    expect(deps.evidenceRef()).toMatch(/^[a-f0-9-]{36}$/);
    expect(deps.evidenceRef()).not.toBe(deps.evidenceRef());
    expect(Math.abs(deps.now() - Date.now())).toBeLessThan(1000);
  });
  it.each(['toss_card_billing', 'kakaopay_subscription'] as const)(
    'binds%s to configured merchant/environment',
    (provider) => {
      expect(
        createReconciliationDependencies()!.configuration(provider),
      ).toEqual({
        environment: 'test',
        merchant:
          provider === 'toss_card_billing' ? 'fixture-mid' : 'fixture-cid',
      });
    },
  );
  it.each([{ ok: false }, { ok: true, data: { mode: 'disabled' } }])(
    'rejects missing integration %#',
    (configured) => {
      mocks.config.mockReturnValue(configured);
      expect(
        createReconciliationDependencies()!.configuration('toss_card_billing'),
      ).toBeNull();
    },
  );
  it('never fabricates a missing configured merchant', () => {
    mocks.env.mockReturnValue({
      ok: true,
      data: { PAYMENTS_RECONCILIATION_ENABLED: true },
    });
    expect(
      createReconciliationDependencies()!.configuration('toss_card_billing'),
    ).toBeNull();
  });
  it('receipt uses shorter six-second DB deadline and no provider transport', () => {
    expect(createProviderReceiptDependencies()).toEqual({
      db: { privateReceipt: true },
      environment: 'test',
      merchant: 'fixture-mid',
    });
    expect(mocks.client).toHaveBeenCalledExactlyOnceWith(
      RECONCILIATION_RECEIPT_TIMEOUT_MS,
    );
    expect(mocks.chargeTransport).not.toHaveBeenCalled();
    expect(mocks.toss).not.toHaveBeenCalled();
  });
  it.each(['env', 'config', 'client'] as const)(
    'receipt fails closed for%s',
    (key) => {
      mocks[key].mockReturnValue(key === 'client' ? null : { ok: false });
      expect(createProviderReceiptDependencies()).toBeNull();
      expect(mocks.receipt).not.toHaveBeenCalled();
    },
  );
  it('initial owner recovery has only same durable cases and query capabilities without worker activation', async () => {
    const disabledEnv = {
      ...env,
      PAYMENTS_RECONCILIATION_ENABLED: false,
    } as unknown as ServerEnv;
    const recovery = createInitialPaymentRecovery(
      disabledEnv,
      client,
      transport,
    );
    expect(await recovery.recover('actor', 'session')).toEqual({
      ok: true,
      data: null,
    });
    const [deps, actor, session] = mocks.initial.mock.calls[0]!;
    expect(actor).toBe('actor');
    expect(session).toBe('session');
    expect(Object.keys(deps.toss.charge)).toEqual(['query']);
    expect(Object.keys(deps.kakao.charge)).toEqual(['query']);
    await expect(deps.toss.refund.query({})).rejects.toThrow(
      'RECOVERY_KIND_INVALID',
    );
    expect(mocks.refundTransport).not.toHaveBeenCalled();
    expect(mocks.tossRefund).not.toHaveBeenCalled();
    expect(deps.configuration('toss_card_billing')).toEqual({
      environment: 'test',
      merchant: 'fixture-mid',
    });
  });
});
