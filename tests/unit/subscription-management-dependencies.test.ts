// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRefundDependencies,
  refundExecutionEnabled,
} from '@/server/subscription-management/dependencies';
const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  client: vi.fn(),
  transport: vi.fn(),
  db: vi.fn(),
  toss: vi.fn(),
  kakao: vi.fn(),
  config: vi.fn(),
}));
vi.mock('@/config/env.server', () => ({ getServerEnv: mocks.env }));
vi.mock('@/server/db/checkout-client', () => ({
  createCheckoutServiceClient: mocks.client,
}));
vi.mock('@/server/db/subscription-management', () => ({
  createRefundDbPort: mocks.db,
}));
vi.mock('@/server/adapters/payment/refund-ci-transport', () => ({
  createRefundTransport: mocks.transport,
}));
vi.mock('@/server/adapters/payment/refund-toss', () => ({
  createTossRefundAdapter: mocks.toss,
}));
vi.mock('@/server/adapters/payment/refund-kakaopay', () => ({
  createKakaoRefundAdapter: mocks.kakao,
}));
vi.mock('@/server/configuration', () => ({
  requireIntegrationConfiguration: mocks.config,
}));
const env = {
  PAYMENTS_REFUNDS_ENABLED: true,
  TOSS_BILLING_MID: 'fictional-mid',
  KAKAOPAY_RECURRING_CID: 'fictional-cid',
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.mockReturnValue({ ok: true, data: env });
  mocks.client.mockReturnValue({ client: true });
  mocks.transport.mockReturnValue(vi.fn());
  mocks.db.mockReturnValue({ db: true });
  mocks.toss.mockReturnValue({ refund: vi.fn(), query: vi.fn() });
  mocks.kakao.mockReturnValue({ refund: vi.fn(), query: vi.fn() });
  mocks.config.mockReturnValue({ ok: true, data: { mode: 'test' } });
});
afterEach(() => vi.useRealTimers());
describe('refund dependency gate', () => {
  it('fails invalid environment before creating clients/adapters', () => {
    mocks.env.mockReturnValue({
      ok: false,
      error: { code: 'CONFIGURATION_INVALID' },
    });
    expect(refundExecutionEnabled()).toBe(false);
    expect(createRefundDependencies()).toBeNull();
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.toss).not.toHaveBeenCalled();
  });
  it.each(['client', 'transport'] as const)(
    'fails missing %s without creating provider adapters',
    (name) => {
      mocks[name].mockReturnValue(null);
      expect(createRefundDependencies()).toBeNull();
      expect(mocks.toss).not.toHaveBeenCalled();
      expect(mocks.kakao).not.toHaveBeenCalled();
    },
  );
  it('allows query-only recovery when new refund dispatch is disabled', () => {
    mocks.env.mockReturnValue({
      ok: true,
      data: { ...env, PAYMENTS_REFUNDS_ENABLED: false },
    });
    expect(refundExecutionEnabled()).toBe(false);
    const deps = createRefundDependencies()!;
    expect(deps.dispatchEnabled).toBe(false);
    expect(deps.toss.query).toBeTypeOf('function');
    expect(deps.kakao.query).toBeTypeOf('function');
    expect(deps.toss.refund).not.toHaveBeenCalled();
    expect(deps.kakao.refund).not.toHaveBeenCalled();
  });
  it('injects guarded transport without making provider calls or exposing keys', () => {
    expect(refundExecutionEnabled()).toBe(true);
    const deps = createRefundDependencies()!;
    expect(deps.db).toEqual({ db: true });
    expect(mocks.db).toHaveBeenCalledExactlyOnceWith({ client: true });
    expect(mocks.toss).toHaveBeenCalledExactlyOnceWith(
      env,
      mocks.transport.mock.results[0]!.value,
    );
    expect(mocks.kakao).toHaveBeenCalledExactlyOnceWith(
      env,
      mocks.transport.mock.results[0]!.value,
    );
    expect(deps.toss.refund).not.toHaveBeenCalled();
    expect(deps.kakao.query).not.toHaveBeenCalled();
    expect(deps.evidenceRef()).toMatch(/^[0-9a-f-]{36}$/);
    expect(deps.evidenceRef()).not.toBe(deps.evidenceRef());
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
    expect(deps.now()).toBe(Date.now());
  });
  it.each(['test', 'live'] as const)(
    'binds each provider to its configured merchant and %s namespace',
    (mode) => {
      mocks.config.mockReturnValue({ ok: true, data: { mode } });
      const deps = createRefundDependencies()!;
      expect(deps.configuration('toss_card_billing')).toEqual({
        environment: mode,
        merchant: env.TOSS_BILLING_MID,
      });
      expect(deps.configuration('kakaopay_subscription')).toEqual({
        environment: mode,
        merchant: env.KAKAOPAY_RECURRING_CID,
      });
      expect(mocks.config).toHaveBeenCalledWith('kakaopay_subscription', {
        ok: true,
        data: env,
      });
    },
  );
  it.each([
    { ok: false, error: { code: 'INTEGRATION_UNAVAILABLE' } },
    { ok: true, data: { mode: 'disabled' } },
  ])('never fabricates provider readiness %#', (configuration) => {
    mocks.config.mockReturnValue(configuration);
    const deps = createRefundDependencies()!;
    expect(deps.configuration('toss_card_billing')).toBeNull();
    expect(deps.configuration('kakaopay_subscription')).toBeNull();
  });
  it('rejects missing merchant despite inconsistent upstream ready result', () => {
    mocks.env.mockReturnValue({
      ok: true,
      data: { PAYMENTS_REFUNDS_ENABLED: true },
    });
    const deps = createRefundDependencies()!;
    expect(deps.configuration('toss_card_billing')).toBeNull();
    expect(deps.configuration('kakaopay_subscription')).toBeNull();
  });
});
