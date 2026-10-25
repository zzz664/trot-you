// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchCron } from '@/server/message-dispatch/cron';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { parseServerEnv } from '@/config/env.server';
import { parsePreparationEnvironment } from '@/server/adapters/payment/preparation';
import { routes } from '@/config/routes';
const mocks = vi.hoisted(() => ({ env: vi.fn(), deps: vi.fn(), run: vi.fn() }));
vi.mock('@/config/env.server', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getServerEnv: mocks.env,
}));
vi.mock('@/server/message-dispatch/dependencies', () => ({
  createDispatchDependencies: mocks.deps,
}));
vi.mock('@/server/services/message-dispatch/worker', () => ({
  dispatchDueMessages: mocks.run,
}));
afterEach(() => vi.useRealTimers());
const secret = 'fictional_dispatch_cron_secret_not_real_123';
const summary = { published: 1, blocked: 0, skipped: 0, hasMore: false };
const request = (
  authorization: string | null = `Bearer ${secret}`,
  method = 'GET',
  query = '',
  body?: string,
) =>
  new Request(`https://app.example${routes.dispatchMessages}${query}`, {
    method,
    headers: authorization === null ? {} : { Authorization: authorization },
    ...(body === undefined ? {} : { body }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.mockReturnValue({
    ok: true,
    data: {
      MESSAGE_DISPATCH_CRON_SECRET: secret,
      MESSAGE_DISPATCH_ENABLED: true,
    },
  });
  mocks.deps.mockReturnValue({ fixture: true });
  mocks.run.mockResolvedValue({ ok: true, data: summary });
});
describe('dedicated fail-closed dispatch cron', () => {
  it.each(['GET', 'POST'])(
    'authenticates %s and returns only aggregate truth',
    async (method) => {
      const response = await dispatchCron(request(undefined, method));
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
      const response = await dispatchCron(request(authorization));
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
      data: { CRON_SECRET: secret, MESSAGE_DISPATCH_ENABLED: true },
    },
    {
      ok: true,
      data: {
        MESSAGE_DISPATCH_CRON_SECRET: secret,
        MESSAGE_DISPATCH_ENABLED: false,
      },
    },
  ])('fails setup %# closed', async (env) => {
    mocks.env.mockReturnValue(env);
    const response = await dispatchCron(request());
    expect(response.status).toBe(503);
    expect(mocks.deps).not.toHaveBeenCalled();
  });
  it.each([
    '?now=2026-01-01',
    '?limit=50',
    '?token=' + secret,
    '?provider=toss',
  ])('rejects request-controlled processing %s', async (query) => {
    expect((await dispatchCron(request(undefined, 'GET', query))).status).toBe(
      400,
    );
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each(['{}', 'null', '{"time":"future"}'])(
    'rejects bodies %#',
    async (body) => {
      expect(
        (await dispatchCron(request(undefined, 'POST', '', body))).status,
      ).toBe(400);
      expect(mocks.deps).not.toHaveBeenCalled();
    },
  );
  it('accepts an empty Node-adapter POST stream, not merely a null body', async () => {
    const req = new Request(`https://app.example${routes.dispatchMessages}`, {
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
    expect((await dispatchCron(req)).status).toBe(200);
    expect(mocks.run).toHaveBeenCalledOnce();
  });
  it('rejects a nonempty stream before creating dependencies', async () => {
    const req = new Request(`https://app.example${routes.dispatchMessages}`, {
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
    expect((await dispatchCron(req)).status).toBe(400);
    expect(mocks.deps).not.toHaveBeenCalled();
  });
  it('bounds a stream that never ends without sleeping', async () => {
    vi.useFakeTimers();
    const req = new Request(`https://app.example${routes.dispatchMessages}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      body: new ReadableStream(),
      duplex: 'half',
    } as RequestInit);
    const pending = dispatchCron(req);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).status).toBe(400);
    expect(mocks.deps).not.toHaveBeenCalled();
  });
  it('HEAD cannot become a dispatch invocation', async () => {
    expect((await dispatchCron(request(undefined, 'HEAD'))).status).toBe(400);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('missing dependencies stay unavailable', async () => {
    mocks.deps.mockReturnValue(null);
    expect((await dispatchCron(request())).status).toBe(503);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each([
    { ok: false, code: 'UNAVAILABLE' },
    { ok: true, data: { ...summary, secret: 'leak' } },
    { ok: true, data: { ...summary, published: 11 } },
    { ok: true, data: { ...summary, blocked: -1 } },
  ])('never emits malformed/private result %#', async (result) => {
    mocks.run.mockResolvedValue(result);
    const response = await dispatchCron(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('does not leak exception body or retry service', async () => {
    mocks.run.mockRejectedValue(new Error('PRIVATE_PROVIDER_BODY'));
    const response = await dispatchCron(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('PRIVATE');
    expect(mocks.run).toHaveBeenCalledOnce();
  });
});
describe('dispatch environment', () => {
  it('does not regress payment configuration when transformed dispatch flags are present', () => {
    const parsed = parseServerEnv({
      MESSAGE_DISPATCH_ENABLED: 'true',
      MESSAGE_DISPATCH_CRON_SECRET: secret,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsePreparationEnvironment(parsed.data)).toMatchObject({
      ok: true,
      data: {
        MESSAGE_DISPATCH_ENABLED: false,
        MESSAGE_DISPATCH_CRON_SECRET: undefined,
      },
    });
  });
  it('defaults disabled without a token', () => {
    expect(parseServerEnv({})).toMatchObject({
      ok: true,
      data: { MESSAGE_DISPATCH_ENABLED: false },
    });
  });
  it('requires dedicated secret for enabled worker', () => {
    expect(
      parseServerEnv({ MESSAGE_DISPATCH_ENABLED: 'true', CRON_SECRET: secret })
        .ok,
    ).toBe(false);
  });
  it('accepts explicit flag and well-formed secret', () => {
    expect(
      parseServerEnv({
        MESSAGE_DISPATCH_ENABLED: 'true',
        MESSAGE_DISPATCH_CRON_SECRET: secret,
      }).ok,
    ).toBe(true);
  });
  it.each([
    'short',
    'a'.repeat(257),
    'a'.repeat(31),
    'has spaces '.repeat(6),
    'x'.repeat(32) + '\n',
  ])('rejects invalid secret %#', (MESSAGE_DISPATCH_CRON_SECRET) => {
    expect(parseServerEnv({ MESSAGE_DISPATCH_CRON_SECRET }).ok).toBe(false);
  });
  it('rejects reusing the general cron secret', () => {
    expect(
      parseServerEnv({
        MESSAGE_DISPATCH_CRON_SECRET: secret,
        CRON_SECRET: secret,
      }).ok,
    ).toBe(false);
  });
  it('rejects a public token', () => {
    expect(
      parseServerEnv({ NEXT_PUBLIC_MESSAGE_DISPATCH_CRON_SECRET: secret }).ok,
    ).toBe(false);
  });
});
