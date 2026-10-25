// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { createBillingNoticeQueueDependencies } from '@/server/billing-notices/dependencies';
const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  client: vi.fn(),
  port: vi.fn(),
}));
vi.mock('@/config/env.server', () => ({ getServerEnv: mocks.env }));
vi.mock('@/server/db/checkout-client', () => ({
  createCheckoutServiceClient: mocks.client,
}));
vi.mock('@/server/db/billing-notices', () => ({
  createBillingNoticeQueuePort: mocks.port,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.mockReturnValue({
    ok: true,
    data: {
      BILLING_NOTICES_ENABLED: true,
      BILLING_NOTICES_CRON_SECRET: 'fixture',
    },
  });
  mocks.client.mockReturnValue({ fixture: true });
  mocks.port.mockReturnValue({ fixturePort: true });
});
it('constructs DB publication capability only, without provider or charge capability', () => {
  expect(createBillingNoticeQueueDependencies()).toMatchObject({
    port: { fixturePort: true },
    now: Date.now,
  });
  expect(mocks.port).toHaveBeenCalledExactlyOnceWith({ fixture: true });
});
it.each([
  { ok: false },
  {
    ok: true,
    data: {
      BILLING_NOTICES_ENABLED: false,
      BILLING_NOTICES_CRON_SECRET: 'fixture',
    },
  },
  { ok: true, data: { BILLING_NOTICES_ENABLED: true } },
])('fails closed before DB client construction %#', (env) => {
  mocks.env.mockReturnValue(env);
  expect(createBillingNoticeQueueDependencies()).toBeNull();
  expect(mocks.client).not.toHaveBeenCalled();
});
it('no server credential means no worker capability', () => {
  mocks.client.mockReturnValue(null);
  expect(createBillingNoticeQueueDependencies()).toBeNull();
  expect(mocks.port).not.toHaveBeenCalled();
});
