// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webPushCron } from '@/server/webpush/cron';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { parseServerEnv } from '@/config/env.server';
import { routes } from '@/config/routes';
import { parsePreparationEnvironment } from '@/server/adapters/payment/preparation';
const mocks = vi.hoisted(() => ({ env: vi.fn(), deps: vi.fn(), run: vi.fn() }));
vi.mock('@/config/env.server', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getServerEnv: mocks.env,
}));
vi.mock('@/server/webpush/dependencies', () => ({
  createWebPushQueueDependencies: mocks.deps,
}));
vi.mock('@/server/services/notification/send-queue', () => ({
  sendWebPushQueue: mocks.run,
}));
afterEach(() => vi.useRealTimers());
const secret = 'fictional_webpush_cron_secret_not_real_123';
const summary = {
  examined: 1,
  recoveryChecked: 0,
  acceptedByPushService: 1,
  skipped: 0,
  uncertain: 0,
  failed: 0,
  hasMore: false,
};
const request = (
  authorization: string | null = `Bearer ${secret}`,
  method = 'GET',
  query = '',
  body?: string,
) =>
  new Request(`https://app.example${routes.sendNotifications}${query}`, {
    method,
    headers: authorization === null ? {} : { Authorization: authorization },
    ...(body === undefined ? {} : { body }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.mockReturnValue({
    ok: true,
    data: {
      WEBPUSH_CRON_SECRET: secret,
      WEBPUSH_ENABLED: true,
      WEBPUSH_WORKER_ENABLED: true,
    },
  });
  mocks.deps.mockReturnValue({ fixture: true });
  mocks.run.mockResolvedValue({ ok: true, data: summary });
});
describe('dedicated fail-closed webpush cron', () => {
  it.each(['GET', 'POST'])(
    'authenticates %s and returns only aggregate truth',
    async (method) => {
      const response = await webPushCron(request(undefined, method));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, data: summary });
      expect(mocks.run).toHaveBeenCalledExactlyOnceWith({ fixture: true });
      for (const [name, value] of Object.entries(AUTH_PRIVATE_HEADERS))
        expect(response.headers.get(name)).toBe(value);
    },
  );
  it.each([
    null,
    '',
    'Bearer',
    'Bearer ',
    'bearer ' + secret,
    'Basic ' + secret,
    secret,
    `Bearer wrong_${secret}`,
    `Bearer ${secret}, Bearer ${secret}`,
    `Bearer ${secret} extra`,
  ])(
    'rejects authorization %# before any dependency',
    async (authorization) => {
      const response = await webPushCron(request(authorization));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        ok: false,
        code: 'UNAUTHORIZED',
      });
      expect(mocks.deps).not.toHaveBeenCalled();
      expect(mocks.run).not.toHaveBeenCalled();
    },
  );
  it.each([
    { ok: false, code: 'CONFIGURATION_INVALID' },
    { ok: true, data: {} },
    {
      ok: true,
      data: { CRON_SECRET: secret, WEBPUSH_WORKER_ENABLED: true },
    },
    {
      ok: true,
      data: {
        WEBPUSH_CRON_SECRET: secret,
        WEBPUSH_WORKER_ENABLED: false,
      },
    },
  ])('fails setup %# closed', async (env) => {
    mocks.env.mockReturnValue(env);
    const response = await webPushCron(request());
    expect(response.status).toBe(503);
    expect(mocks.deps).not.toHaveBeenCalled();
  });
  it.each([
    '?now=2026-01-01',
    '?limit=50',
    '?token=' + secret,
    '?provider=toss',
  ])('rejects request-controlled processing %s', async (query) => {
    expect((await webPushCron(request(undefined, 'GET', query))).status).toBe(
      400,
    );
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each(['{}', 'null', '{"time":"future"}'])(
    'rejects bodies %#',
    async (body) => {
      expect(
        (await webPushCron(request(undefined, 'POST', '', body))).status,
      ).toBe(400);
      expect(mocks.deps).not.toHaveBeenCalled();
    },
  );
  it('accepts an empty Node-adapter POST stream, not merely a null body', async () => {
    const req = new Request(`https://app.example${routes.sendNotifications}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect(req.body).not.toBeNull();
    expect((await webPushCron(req)).status).toBe(200);
    expect(mocks.run).toHaveBeenCalledOnce();
  });
  it('rejects a nonempty stream before creating dependencies', async () => {
    const req = new Request(`https://app.example${routes.sendNotifications}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect((await webPushCron(req)).status).toBe(400);
    expect(mocks.deps).not.toHaveBeenCalled();
  });
  it('bounds a stream that never ends without sleeping', async () => {
    vi.useFakeTimers();
    const req = new Request(`https://app.example${routes.sendNotifications}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      body: new ReadableStream(),
      duplex: 'half',
    } as RequestInit);
    const pending = webPushCron(req);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).status).toBe(400);
    expect(mocks.deps).not.toHaveBeenCalled();
  });
  it('HEAD cannot become a webpush invocation', async () => {
    expect((await webPushCron(request(undefined, 'HEAD'))).status).toBe(400);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('missing dependencies stay unavailable', async () => {
    mocks.deps.mockReturnValue(null);
    expect((await webPushCron(request())).status).toBe(503);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each([
    { ok: false, code: 'UNAVAILABLE' },
    { ok: true, data: { ...summary, secret: 'leak' } },
    { ok: true, data: { ...summary, acceptedByPushService: 101 } },
    { ok: true, data: { ...summary, failed: -1 } },
    { ok: true, data: { ...summary, skipped: 1 } },
  ])('never emits malformed/private result %#', async (result) => {
    mocks.run.mockResolvedValue(result);
    const response = await webPushCron(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('does not leak exception body or retry service', async () => {
    mocks.run.mockRejectedValue(new Error('PRIVATE_PROVIDER_BODY'));
    const response = await webPushCron(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('PRIVATE');
    expect(mocks.run).toHaveBeenCalledOnce();
  });
});
describe('webpush environment configuration', () => {
  it('does not regress payment configuration when new webpush flags are transformed', () => {
    const parsed = parseServerEnv({
      WEBPUSH_ENABLED: 'true',
      WEBPUSH_WORKER_ENABLED: 'true',
      WEBPUSH_CRON_SECRET: secret,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsePreparationEnvironment(parsed.data)).toMatchObject({
      ok: true,
      data: {
        WEBPUSH_ENABLED: false,
        WEBPUSH_WORKER_ENABLED: false,
        WEBPUSH_CRON_SECRET: undefined,
      },
    });
  });
  it('defaults both integration and worker disabled', () => {
    expect(parseServerEnv({})).toMatchObject({
      ok: true,
      data: { WEBPUSH_ENABLED: false, WEBPUSH_WORKER_ENABLED: false },
    });
  });
  it('allows registration without activating a scheduler', () => {
    expect(parseServerEnv({ WEBPUSH_ENABLED: 'true' })).toMatchObject({
      ok: true,
      data: { WEBPUSH_ENABLED: true, WEBPUSH_WORKER_ENABLED: false },
    });
  });
  it.each([
    { WEBPUSH_WORKER_ENABLED: 'true' },
    { WEBPUSH_WORKER_ENABLED: 'true', WEBPUSH_CRON_SECRET: secret },
    {
      WEBPUSH_WORKER_ENABLED: 'true',
      WEBPUSH_ENABLED: 'true',
      CRON_SECRET: secret,
    },
  ])('requires both activation flags plus dedicated secret %#', (input) => {
    expect(parseServerEnv(input).ok).toBe(false);
  });
  it('accepts intentionally enabled isolated worker', () => {
    expect(
      parseServerEnv({
        WEBPUSH_WORKER_ENABLED: 'true',
        WEBPUSH_ENABLED: 'true',
        WEBPUSH_CRON_SECRET: secret,
      }).ok,
    ).toBe(true);
  });
  it.each([
    'CRON_SECRET',
    'RENEWAL_CRON_SECRET',
    'RECONCILIATION_CRON_SECRET',
    'MESSAGE_DISPATCH_CRON_SECRET',
  ])('rejects reuse of %s', (other) => {
    expect(
      parseServerEnv({ WEBPUSH_CRON_SECRET: secret, [other]: secret }).ok,
    ).toBe(false);
  });
  it.each([
    'short',
    'a'.repeat(257),
    'a'.repeat(31),
    'has spaces '.repeat(6),
    'x'.repeat(32) + '\n',
  ])('rejects malformed secret %#', (WEBPUSH_CRON_SECRET) => {
    expect(parseServerEnv({ WEBPUSH_CRON_SECRET }).ok).toBe(false);
  });
  it.each([
    'NEXT_PUBLIC_WEBPUSH_CRON_SECRET',
    'NEXT_PUBLIC_VAPID_PRIVATE_KEY',
    'NEXT_PUBLIC_VAPID_SUBJECT',
  ])('rejects public secret alias %s', (key) => {
    expect(parseServerEnv({ [key]: secret }).ok).toBe(false);
  });
});
