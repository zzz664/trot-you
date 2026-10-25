// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { createScheduleNoticeQueueDependencies } from '@/server/schedule-notices/dependencies';
const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  client: vi.fn(),
  port: vi.fn(),
}));
vi.mock('@/config/env.server', () => ({ getServerEnv: mocks.env }));
vi.mock('@/server/db/checkout-client', () => ({
  createCheckoutServiceClient: mocks.client,
}));
vi.mock('@/server/db/schedule-notice-queue', () => ({
  createScheduleNoticeQueuePort: mocks.port,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.mockReturnValue({
    ok: true,
    data: {
      SCHEDULE_NOTICES_ENABLED: true,
      SCHEDULE_NOTICES_CRON_SECRET: 'fixture',
    },
  });
  mocks.client.mockReturnValue({ fixture: true });
  mocks.port.mockReturnValue({ fixturePort: true });
});
it('constructs DB publication capability only, without provider or charge capability', () => {
  expect(createScheduleNoticeQueueDependencies()).toMatchObject({
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
      SCHEDULE_NOTICES_ENABLED: false,
      SCHEDULE_NOTICES_CRON_SECRET: 'fixture',
    },
  },
  { ok: true, data: { SCHEDULE_NOTICES_ENABLED: true } },
])('fails closed before DB client construction %#', (env) => {
  mocks.env.mockReturnValue(env);
  expect(createScheduleNoticeQueueDependencies()).toBeNull();
  expect(mocks.client).not.toHaveBeenCalled();
});
it('no server credential means no worker capability', () => {
  mocks.client.mockReturnValue(null);
  expect(createScheduleNoticeQueueDependencies()).toBeNull();
  expect(mocks.port).not.toHaveBeenCalled();
});
