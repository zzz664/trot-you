// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tossPaymentWebhook } from '@/server/provider-events/http';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  deps: vi.fn(),
  parse: vi.fn(),
  receive: vi.fn(),
}));
vi.mock('@/config/env.server', () => ({ getServerEnv: mocks.env }));
vi.mock('@/server/provider-events/dependencies', () => ({
  createProviderReceiptDependencies: mocks.deps,
}));
vi.mock('@/server/provider-events/security', () => ({
  readTossProviderEvent: mocks.parse,
}));
vi.mock('@/server/services/reconciliation/receive', () => ({
  receiveTossEvent: mocks.receive,
}));
const request = (query = '') =>
  new Request(`https://app.example/api/webhooks/payment/toss${query}`, {
    method: 'POST',
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.mockReturnValue({
    ok: true,
    data: { PAYMENTS_RECONCILIATION_ENABLED: true },
  });
  mocks.deps.mockReturnValue({ private: true });
  mocks.parse.mockResolvedValue({ ok: true, data: { trust: 'unverified' } });
  mocks.receive.mockResolvedValue({ ok: true, data: null });
});
describe('untrusted Toss notification HTTP boundary', () => {
  it('returns minimal200 after durable receipt with private cache headers', async () => {
    const response = await tossPaymentWebhook(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.receive).toHaveBeenCalledExactlyOnceWith(
      { private: true },
      { trust: 'unverified' },
    );
    for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
      expect(response.headers.get(key)).toBe(value);
  });
  it.each([
    { ok: false },
    { ok: true, data: {} },
    { ok: true, data: { PAYMENTS_RECONCILIATION_ENABLED: false } },
  ])('disabled config %# stops before parsing', async (env) => {
    mocks.env.mockReturnValue(env);
    expect((await tossPaymentWebhook(request())).status).toBe(503);
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.deps).not.toHaveBeenCalled();
  });
  it.each(['?token=anything', '?provider=kakao', '?amount=1'])(
    'rejects request controls %s',
    async (query) => {
      expect((await tossPaymentWebhook(request(query))).status).toBe(400);
      expect(mocks.parse).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['INVALID_INPUT', 400],
    ['UNSUPPORTED_EVENT', 422],
    ['PAYLOAD_TOO_LARGE', 413],
  ])('rejects %s before DB', async (code, status) => {
    mocks.parse.mockResolvedValue({ ok: false, code });
    const response = await tossPaymentWebhook(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, code });
    expect(mocks.deps).not.toHaveBeenCalled();
  });
  it('fails closed for unavailable merchant or database capability', async () => {
    mocks.deps.mockReturnValue(null);
    expect((await tossPaymentWebhook(request())).status).toBe(503);
    expect(mocks.receive).not.toHaveBeenCalled();
  });
  it('durability failure returns503 for provider delivery retry, never fake success', async () => {
    mocks.receive.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    const response = await tossPaymentWebhook(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it.each(['env', 'deps', 'parse', 'receive'] as const)(
    'redacts exception at%s',
    async (name) => {
      mocks[name].mockImplementation(() => {
        throw new Error('PRIVATE_PROVIDER_BODY');
      });
      const response = await tossPaymentWebhook(request());
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain('PRIVATE');
    },
  );
});
