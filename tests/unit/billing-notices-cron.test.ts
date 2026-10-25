// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { billingNoticeCron } from '@/server/billing-notices/cron';
import { parseServerEnv } from '@/config/env.server';
import { parsePreparationEnvironment } from '@/server/adapters/payment/preparation';
import { routes } from '@/config/routes';
const mocks = vi.hoisted(() => ({ env: vi.fn(), deps: vi.fn(), run: vi.fn() }));
vi.mock('@/config/env.server', async (original) => ({
  ...(await original<object>()),
  getServerEnv: mocks.env,
}));
vi.mock('@/server/billing-notices/dependencies', () => ({
  createBillingNoticeQueueDependencies: mocks.deps,
}));
vi.mock('@/server/services/billing-notices/create-due', () => ({
  createDueBillingNotices: mocks.run,
}));
const secret = 'fictional_billing_notice_cron_secret_123';
const summary = {
  examined: 1,
  created: 1,
  skipped: 0,
  failed: 0,
  pushJobsQueued: 2,
  hasMore: false,
};
function request(
  authorization: string | null = `Bearer ${secret}`,
  method = 'GET',
  query = '',
  body?: string,
) {
  return new Request(
    `https://app.example${routes.createBillingNotices}${query}`,
    {
      method,
      headers: authorization === null ? {} : { authorization },
      ...(body === undefined ? {} : { body }),
    },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.mockReturnValue({
    ok: true,
    data: {
      BILLING_NOTICES_ENABLED: true,
      BILLING_NOTICES_CRON_SECRET: secret,
    },
  });
  mocks.deps.mockReturnValue({ fixture: true });
  mocks.run.mockResolvedValue({ ok: true, data: summary });
});
it.each(['GET', 'POST'])(
  'creates only inbox/queue and returns aggregate truth %s',
  async (method) => {
    const response = await billingNoticeCron(request(undefined, method));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: summary });
    expect(response.headers.get('cache-control')).toContain('no-store');
  },
);
it.each([null, '', secret, `bearer ${secret}`, `Bearer wrong_${secret}`])(
  'rejects authorization %# before dependency construction',
  async (auth) => {
    expect((await billingNoticeCron(request(auth))).status).toBe(401);
    expect(mocks.deps).not.toHaveBeenCalled();
  },
);
it.each([
  ['GET', '?token=secret', undefined],
  ['PUT', '', undefined],
  ['POST', '', '{}'],
])('rejects route-shape/body %#', async (method, query, body) => {
  expect(
    (await billingNoticeCron(request(undefined, method, query, body))).status,
  ).toBe(400);
  expect(mocks.run).not.toHaveBeenCalled();
});
it('disabled worker does not construct DB dependencies', async () => {
  mocks.env.mockReturnValue({
    ok: true,
    data: {
      BILLING_NOTICES_ENABLED: false,
      BILLING_NOTICES_CRON_SECRET: secret,
    },
  });
  expect((await billingNoticeCron(request())).status).toBe(503);
  expect(mocks.deps).not.toHaveBeenCalled();
});
it('rejects malformed summary instead of claiming creation/delivery', async () => {
  mocks.run.mockResolvedValue({ ok: true, data: { ...summary, created: 2 } });
  expect(await (await billingNoticeCron(request())).json()).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('keeps operational worker flag disabled by default and needs dedicated secret', () => {
  const base = { NEXT_PUBLIC_APP_URL: 'http://localhost:3000' };
  expect(parseServerEnv(base)).toMatchObject({
    ok: true,
    data: { BILLING_NOTICES_ENABLED: false },
  });
  expect(parseServerEnv({ ...base, BILLING_NOTICES_ENABLED: 'true' }).ok).toBe(
    false,
  );
  const enabled = parseServerEnv({
    ...base,
    BILLING_NOTICES_ENABLED: 'true',
    BILLING_NOTICES_CRON_SECRET: secret,
  });
  expect(enabled.ok).toBe(true);
  if (enabled.ok)
    expect(parsePreparationEnvironment(enabled.data).ok).toBe(true);
});
it.each([
  'CRON_SECRET',
  'RENEWAL_CRON_SECRET',
  'RECONCILIATION_CRON_SECRET',
  'MESSAGE_DISPATCH_CRON_SECRET',
  'WEBPUSH_CRON_SECRET',
])('forbids secret reuse with %s', (name) => {
  expect(
    parseServerEnv({
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      BILLING_NOTICES_ENABLED: 'true',
      BILLING_NOTICES_CRON_SECRET: secret,
      [name]: secret,
    }).ok,
  ).toBe(false);
});
