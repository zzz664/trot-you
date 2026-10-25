// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DISPATCH_WORKER_REQUEST_TIMEOUT_MS } from '@/config/message-dispatch';
import { createDispatchDependencies } from '@/server/message-dispatch/dependencies';
const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  client: vi.fn(),
  db: vi.fn(),
}));
vi.mock('@/config/env.server', () => ({ getServerEnv: mocks.env }));
vi.mock('@/server/db/checkout-client', () => ({
  createCheckoutServiceClient: mocks.client,
}));
vi.mock('@/server/db/message-dispatch', () => ({
  createDispatchWorkerPort: mocks.db,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.mockReturnValue({
    ok: true,
    data: {
      MESSAGE_DISPATCH_ENABLED: true,
      MESSAGE_DISPATCH_CRON_SECRET: 'private',
    },
  });
  mocks.client.mockReturnValue({ local: true });
  mocks.db.mockReturnValue({ bounded: true });
});
describe('database-only worker dependency', () => {
  it.each([
    { ok: false },
    { ok: true, data: {} },
    {
      ok: true,
      data: {
        MESSAGE_DISPATCH_ENABLED: false,
        MESSAGE_DISPATCH_CRON_SECRET: 'private',
      },
    },
  ])('does not construct capability when disabled/invalid %#', (env) => {
    mocks.env.mockReturnValue(env);
    expect(createDispatchDependencies()).toBeNull();
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('uses dedicated bounded database client and no delivery adapter', () => {
    expect(createDispatchDependencies()).toEqual({ bounded: true });
    expect(mocks.client).toHaveBeenCalledExactlyOnceWith(
      DISPATCH_WORKER_REQUEST_TIMEOUT_MS,
    );
    expect(mocks.db).toHaveBeenCalledExactlyOnceWith({ local: true });
  });
  it('fails missing service capability closed', () => {
    mocks.client.mockReturnValue(null);
    expect(createDispatchDependencies()).toBeNull();
    expect(mocks.db).not.toHaveBeenCalled();
  });
});
