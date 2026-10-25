// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { scheduleNoticeCron } from '@/server/schedule-notices/cron';
import { parseServerEnv } from '@/config/env.server';
import { parsePreparationEnvironment } from '@/server/adapters/payment/preparation';
import { routes } from '@/config/routes';
const mocks = vi.hoisted(() => ({ env: vi.fn(), deps: vi.fn(), run: vi.fn() }));
vi.mock('@/config/env.server', async (original) => ({
  ...(await original<object>()),
  getServerEnv: mocks.env,
}));
vi.mock('@/server/schedule-notices/dependencies', () => ({
  createScheduleNoticeQueueDependencies: mocks.deps,
}));
vi.mock('@/server/services/schedule-notices/create-due', () => ({
  createDueScheduleNotices: mocks.run,
}));
const secret = 'fictional_schedule_notice_cron_secret_123';
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
    `https://app.example${routes.notifySchedulesCron}${query}`,
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
      SCHEDULE_NOTICES_ENABLED: true,
      SCHEDULE_NOTICES_CRON_SECRET: secret,
    },
  });
  mocks.deps.mockReturnValue({ fixture: true });
  mocks.run.mockResolvedValue({ ok: true, data: summary });
});
it.each(['GET', 'POST'])(
  'creates only schedule queue and returns aggregate truth %s',
  async (method) => {
    const response = await scheduleNoticeCron(request(undefined, method));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: summary });
    expect(response.headers.get('cache-control')).toContain('no-store');
  },
);
it.each([null, '', secret, `bearer ${secret}`, `Bearer wrong_${secret}`])(
  'rejects authorization %# before dependency construction',
  async (auth) => {
    expect((await scheduleNoticeCron(request(auth))).status).toBe(401);
    expect(mocks.deps).not.toHaveBeenCalled();
  },
);
it.each([
  ['GET', '?token=secret', undefined],
  ['PUT', '', undefined],
  ['POST', '', '{}'],
])('rejects route-shape/body %#', async (method, query, body) => {
  expect(
    (await scheduleNoticeCron(request(undefined, method, query, body))).status,
  ).toBe(400);
  expect(mocks.run).not.toHaveBeenCalled();
});
it('disabled worker does not construct DB dependencies', async () => {
  mocks.env.mockReturnValue({
    ok: true,
    data: {
      SCHEDULE_NOTICES_ENABLED: false,
      SCHEDULE_NOTICES_CRON_SECRET: secret,
    },
  });
  expect((await scheduleNoticeCron(request())).status).toBe(503);
  expect(mocks.deps).not.toHaveBeenCalled();
});
it('rejects malformed summary instead of claiming creation/delivery', async () => {
  mocks.run.mockResolvedValue({ ok: true, data: { ...summary, created: 2 } });
  expect(await (await scheduleNoticeCron(request())).json()).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('keeps operational worker flag disabled by default and needs dedicated secret', () => {
  const base = { NEXT_PUBLIC_APP_URL: 'http://localhost:3000' };
  expect(parseServerEnv(base)).toMatchObject({
    ok: true,
    data: { SCHEDULE_NOTICES_ENABLED: false },
  });
  expect(parseServerEnv({ ...base, SCHEDULE_NOTICES_ENABLED: 'true' }).ok).toBe(
    false,
  );
  const enabled = parseServerEnv({
    ...base,
    SCHEDULE_NOTICES_ENABLED: 'true',
    SCHEDULE_NOTICES_CRON_SECRET: secret,
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
  'BILLING_NOTICES_CRON_SECRET',
])('forbids secret reuse with %s', (name) => {
  expect(
    parseServerEnv({
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      SCHEDULE_NOTICES_ENABLED: 'true',
      SCHEDULE_NOTICES_CRON_SECRET: secret,
      [name]: secret,
    }).ok,
  ).toBe(false);
});

it('unapproved runtime notice policy is setup-not-ready, not empty success', async () => {
  mocks.run.mockResolvedValue({ ok: false, code: 'SETUP_NOT_READY' });
  const result = await scheduleNoticeCron(request());
  expect(result.status).toBe(503);
  expect(await result.json()).toEqual({ ok: false, code: 'SETUP_NOT_READY' });
});
it.each(['SCHEDULE_NOTICES_CRON_SECRET', 'SCHEDULE_NOTICES_ENABLED'])(
  'never permits accidental NEXT_PUBLIC %s exposure',
  (key) => {
    expect(
      parseServerEnv({
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
        [`NEXT_PUBLIC_${key}`]: 'true',
      }).ok,
    ).toBe(false);
  },
);
it('configuration exceptions are redacted and never construct a DB capability', async () => {
  mocks.env.mockImplementation(() => {
    throw new Error('private secret');
  });
  expect(await (await scheduleNoticeCron(request())).json()).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
  expect(mocks.deps).not.toHaveBeenCalled();
});
