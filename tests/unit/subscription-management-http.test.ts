// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { ENROLLMENT_CHARGE_TIMEOUT_MS } from '@/config/enrollment-provider';
import {
  MANAGEMENT_BODY_LIMIT,
  MANAGEMENT_BODY_TIMEOUT_MS,
} from '@/config/subscription-management';
import {
  managementPost,
  managementStatus,
} from '@/server/subscription-management/http';
import * as cancelRoute from '@/app/api/subscriptions/cancel/route';
import * as requestRoute from '@/app/api/subscriptions/refund-request/route';
import * as authorizeRoute from '@/app/api/admin/refunds/authorize/route';
import * as rejectRoute from '@/app/api/admin/refunds/reject/route';
import * as executeRoute from '@/app/api/admin/refunds/execute/route';
import * as reconcileRoute from '@/app/api/admin/refunds/reconcile/route';
import {
  managementIds as ids,
  managementAdmin,
  managementAuthorized,
  managementCanceled,
  managementRequest,
  managementSubscription,
} from './management-fixtures';
const mocks = vi.hoisted(() => ({
  observation: vi.fn(),
  context: vi.fn(),
  db: vi.fn(),
  dependencies: vi.fn(),
  enabled: vi.fn(),
  run: vi.fn(),
  port: {
    list: vi.fn(),
    read: vi.fn(),
    cancel: vi.fn(),
    request: vi.fn(),
    adminRead: vi.fn(),
    adminList: vi.fn(),
    authorize: vi.fn(),
    reject: vi.fn(),
  },
}));
vi.mock('@/server/analytics/capture', () => ({
  getAnalyticsCapturePort: () => ({
    server: mocks.observation,
    cancellation: mocks.observation,
  }),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/db/subscription-management', () => ({
  createManagementDbPort: mocks.db,
}));
vi.mock('@/server/subscription-management/dependencies', () => ({
  createRefundDependencies: mocks.dependencies,
  refundExecutionEnabled: mocks.enabled,
}));
vi.mock('@/server/services/subscription/refund', () => ({
  runRefund: mocks.run,
}));
const origin = 'https://app.example.test';
const profile = {
  id: ids.other,
  role: 'fan',
  onboarding_completed_at: '2026-10-24T12:00:00Z',
  is_restricted: false,
  restricted_until: null,
};
function context(patch: Record<string, unknown> = {}) {
  return {
    configuration: { appOrigin: origin },
    client: { actorClient: true },
    port: {
      verifySubject: vi.fn().mockResolvedValue({ ok: true, data: profile.id }),
      readProfile: vi
        .fn()
        .mockResolvedValue({ ok: true, data: { ...profile, ...patch } }),
    },
    apply: vi.fn((response: NextResponse) => {
      for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
        response.headers.set(key, value);
      return response;
    }),
  };
}
function post(
  body: unknown = { subscriptionId: ids.subscription },
  source: string | null = origin,
  search = '',
  type = 'application/json',
) {
  const headers = new Headers({
    'Content-Type': type,
    Host: 'hostile.invalid',
    'X-Forwarded-Host': 'hostile.invalid',
  });
  if (source !== null) headers.set('Origin', source);
  return new NextRequest(
    `https://poisoned.invalid/api/subscriptions/cancel${search}`,
    {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
  );
}
function get(search: string) {
  return new NextRequest(`${origin}/api/subscriptions/status${search}`);
}
async function expectResult(
  response: Response,
  status: number,
  value: unknown,
) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual(value);
  for (const [key, expected] of Object.entries(AUTH_PRIVATE_HEADERS))
    expect(response.headers.get(key)).toBe(expected);
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.observation.mockResolvedValue({ ok: true, data: null });
  mocks.context.mockReturnValue(context());
  mocks.db.mockReturnValue(mocks.port);
  mocks.dependencies.mockReturnValue({ fixtureDependencies: true });
  mocks.enabled.mockReturnValue(true);
  mocks.port.cancel.mockResolvedValue({ ok: true, data: null });
  mocks.port.read.mockResolvedValue({ ok: true, data: managementCanceled });
  mocks.port.request.mockResolvedValue({ ok: true, data: managementRequest });
  mocks.port.adminRead.mockResolvedValue({ ok: true, data: managementAdmin });
  mocks.port.authorize.mockResolvedValue({
    ok: true,
    data: managementAuthorized.request,
  });
  mocks.port.reject.mockResolvedValue({
    ok: true,
    data: { ...managementRequest, status: 'rejected' },
  });
  mocks.run.mockResolvedValue({ ok: true, data: managementAuthorized });
});
afterEach(() => vi.useRealTimers());
describe('subscription management HTTP authority', () => {
  it('uses actor RPC for cancellation, preserves paid access and ignores poisoned host headers', async () => {
    await expectResult(await managementPost(post(), 'cancel'), 200, {
      ok: true,
      data: managementCanceled,
    });
    expect(mocks.db).toHaveBeenCalledWith({ actorClient: true });
    expect(mocks.port.cancel).toHaveBeenCalledExactlyOnceWith(ids.subscription);
    expect(mocks.dependencies).not.toHaveBeenCalled();
    expect(mocks.enabled).not.toHaveBeenCalled();
  });
  it.each([
    { is_restricted: true },
    { role: 'artist' },
    { role: 'admin' },
    { onboarding_completed_at: null },
  ])(
    'permits existing owner billing control despite %j, leaving ownership to actor RPC',
    async (patch) => {
      mocks.context.mockReturnValue(context(patch));
      expect((await managementPost(post(), 'cancel')).status).toBe(200);
      mocks.port.cancel.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
      await expectResult(await managementPost(post(), 'cancel'), 403, {
        ok: false,
        code: 'FORBIDDEN',
      });
    },
  );
  it('permits restricted owner refund request without payment configuration or automatic authorization', async () => {
    mocks.context.mockReturnValue(context({ is_restricted: true }));
    const body = {
      subscriptionId: ids.subscription,
      originalEventId: ids.charge,
      amountKrw: managementRequest.amount_krw,
      reason: managementRequest.reason,
      idempotencyKey: ids.key,
    };
    expect((await managementPost(post(body), 'request')).status).toBe(200);
    expect(mocks.port.request).toHaveBeenCalledExactlyOnceWith(body);
    expect(mocks.dependencies).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each([
    null,
    'null',
    'https://other.example',
    `${origin}/`,
    'http://app.example.test',
  ])(
    'rejects nonexact or missing Origin %s before session/DB/provider',
    async (source) => {
      const ctx = context();
      mocks.context.mockReturnValue(ctx);
      await expectResult(
        await managementPost(post(undefined, source), 'cancel'),
        403,
        { ok: false, code: 'FORBIDDEN' },
      );
      expect(ctx.port.verifySubject).not.toHaveBeenCalled();
      expect(mocks.db).not.toHaveBeenCalled();
      expect(mocks.dependencies).not.toHaveBeenCalled();
    },
  );
  it('rejects mutation query strings instead of accepting alternate identities', async () => {
    await expectResult(
      await managementPost(
        post(undefined, origin, '?subscription=other'),
        'cancel',
      ),
      400,
      { ok: false, code: 'INVALID_INPUT' },
    );
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it.each(['configuration', 'client', 'port'] as const)(
    'fails missing auth %s without any database/provider call',
    async (field) => {
      const ctx = { ...context(), [field]: null };
      mocks.context.mockReturnValue(ctx);
      await expectResult(await managementPost(post(), 'cancel'), 503, {
        ok: false,
        code: 'SETUP_NOT_READY',
      });
      expect(mocks.db).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['anonymous', 401, 'UNAUTHENTICATED'],
    ['unavailable', 503, 'UNAVAILABLE'],
    ['mismatched', 503, 'UNAVAILABLE'],
  ])('fails %s verified session', async (kind, status, code) => {
    const ctx = context();
    if (kind === 'anonymous')
      ctx.port.verifySubject.mockResolvedValue({ ok: true, data: null });
    if (kind === 'unavailable')
      ctx.port.verifySubject.mockResolvedValue({
        ok: false,
        error: { code: 'INTERNAL' },
      });
    if (kind === 'mismatched')
      ctx.port.readProfile.mockResolvedValue({
        ok: true,
        data: { ...profile, id: ids.artist },
      });
    mocks.context.mockReturnValue(ctx);
    await expectResult(await managementPost(post(), 'cancel'), Number(status), {
      ok: false,
      code,
    });
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it.each(['authorize', 'reject', 'execute', 'reconcile'] as const)(
    'requires current unrestricted admin for %s',
    async (action) => {
      for (const patch of [
        { role: 'fan' },
        { role: 'artist' },
        { role: 'admin', is_restricted: true },
      ]) {
        mocks.context.mockReturnValue(context(patch));
        await expectResult(
          await managementPost(post({ requestId: ids.request }), action),
          403,
          { ok: false, code: 'FORBIDDEN' },
        );
      }
      expect(mocks.db).not.toHaveBeenCalled();
      expect(mocks.run).not.toHaveBeenCalled();
    },
  );
  it('routes explicit admin authorization and rejects missing acceptance/extra monetary instructions before RPC', async () => {
    mocks.context.mockReturnValue(context({ role: 'admin' }));
    mocks.port.adminRead.mockResolvedValue({
      ok: true,
      data: managementAuthorized,
    });
    const body = {
      requestId: ids.request,
      amountKrw: 500,
      policyVersion: ids.policy,
      reason: 'reviewed fictional policy',
      accepted: true,
    };
    expect((await managementPost(post(body), 'authorize')).status).toBe(200);
    expect(mocks.port.authorize).toHaveBeenCalledExactlyOnceWith(body);
    for (const patch of [
      { accepted: false },
      { amountKrw: -1 },
      { policyVersion: 'bad' },
      { providerPaymentId: 'injected' },
    ]) {
      expect(
        (await managementPost(post({ ...body, ...patch }), 'authorize')).status,
      ).toBe(400);
    }
    expect(mocks.port.authorize).toHaveBeenCalledOnce();
    expect(mocks.dependencies).not.toHaveBeenCalled();
  });
  it('routes explicit rejection separately without payment dependencies', async () => {
    mocks.context.mockReturnValue(context({ role: 'admin' }));
    const body = { requestId: ids.request, reason: 'fictional rejection' };
    expect((await managementPost(post(body), 'reject')).status).toBe(200);
    expect(mocks.port.reject).toHaveBeenCalledExactlyOnceWith(body);
    expect(mocks.dependencies).not.toHaveBeenCalled();
  });
  it.each(['execute', 'reconcile'] as const)(
    'passes only verified session actor to %s worker',
    async (action) => {
      mocks.context.mockReturnValue(context({ role: 'admin' }));
      const body = { requestId: ids.request };
      expect((await managementPost(post(body), action)).status).toBe(200);
      expect(mocks.run).toHaveBeenCalledExactlyOnceWith(
        { fixtureDependencies: true },
        mocks.port,
        profile.id,
        body,
        action,
      );
    },
  );
  it('does not execute when dependency configuration is unavailable', async () => {
    mocks.context.mockReturnValue(context({ role: 'admin' }));
    mocks.dependencies.mockReturnValue(null);
    await expectResult(
      await managementPost(post({ requestId: ids.request }), 'execute'),
      503,
      { ok: false, code: 'SETUP_NOT_READY' },
    );
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each(['text/plain', 'application/x-www-form-urlencoded'])(
    'rejects %s body before service calls',
    async (type) => {
      await expectResult(
        await managementPost(post('{}', origin, '', type), 'cancel'),
        400,
        { ok: false, code: 'INVALID_INPUT' },
      );
      expect(mocks.db).not.toHaveBeenCalled();
    },
  );
  it.each(['{malformed', 'x'.repeat(MANAGEMENT_BODY_LIMIT + 1)])(
    'rejects malformed/oversized body %# without mutation',
    async (body) => {
      await expectResult(await managementPost(post(body), 'cancel'), 400, {
        ok: false,
        code: 'INVALID_INPUT',
      });
      expect(mocks.port.cancel).not.toHaveBeenCalled();
    },
  );
  it('bounds slow-body request before constructing the actor DB port', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{'));
      },
      cancel,
    });
    const request = new NextRequest(`${origin}/api/subscriptions/cancel`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body,
      duplex: 'half',
    } as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
    const pending = managementPost(request, 'cancel');
    await vi.advanceTimersByTimeAsync(MANAGEMENT_BODY_TIMEOUT_MS);
    await expectResult(await pending, 400, {
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it('mutation route modules export POST, never GET, and monetary routes exceed provider deadline', () => {
    for (const route of [
      cancelRoute,
      requestRoute,
      authorizeRoute,
      rejectRoute,
      executeRoute,
      reconcileRoute,
    ]) {
      expect(route.POST).toBeTypeOf('function');
      expect(route).not.toHaveProperty('GET');
    }
    expect(executeRoute.maxDuration * 1000).toBeGreaterThan(
      ENROLLMENT_CHARGE_TIMEOUT_MS,
    );
    expect(executeRoute.maxDuration).toBeGreaterThanOrEqual(180);
  });
});
describe('management read-only status endpoint', () => {
  it('GET reads owner status without mutating or requiring Origin', async () => {
    mocks.port.read.mockResolvedValue({
      ok: true,
      data: managementSubscription,
    });
    await expectResult(
      await managementStatus(get(`?subscription=${ids.subscription}`)),
      200,
      { ok: true, data: managementSubscription },
    );
    expect(mocks.port.cancel).not.toHaveBeenCalled();
    expect(mocks.port.request).not.toHaveBeenCalled();
    expect(mocks.dependencies).not.toHaveBeenCalled();
  });
  it('accepts only exact owner ID/page query keys and delegates ownership to actor RPC', async () => {
    mocks.port.read.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    await expectResult(
      await managementStatus(get(`?subscription=${ids.other}&page=2`)),
      403,
      { ok: false, code: 'FORBIDDEN' },
    );
    expect(mocks.port.read).toHaveBeenCalledExactlyOnceWith(ids.other, 2);
  });
  it.each([
    '',
    '?subscription=bad',
    `?subscription=${ids.subscription}&subscription=${ids.other}`,
    `?subscription=${ids.subscription}&page=1&page=2`,
    `?subscription=${ids.subscription}&provider=toss`,
    `?subscription=${ids.subscription}&page=0`,
  ])('rejects malformed owner query %s', async (search) => {
    await expectResult(await managementStatus(get(search)), 400, {
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(mocks.port.read).not.toHaveBeenCalled();
  });
  it('requires fresh unrestricted admin and exact no-page query for private review status', async () => {
    await expectResult(
      await managementStatus(get(`?request=${ids.request}`), true),
      403,
      { ok: false, code: 'FORBIDDEN' },
    );
    mocks.context.mockReturnValue(context({ role: 'admin' }));
    expect(
      (await managementStatus(get(`?request=${ids.request}`), true)).status,
    ).toBe(200);
    for (const search of [
      `?request=${ids.request}&page=1`,
      `?request=${ids.request}&request=${ids.other}`,
      `?request=${ids.request}&subscription=${ids.subscription}`,
    ]) {
      expect((await managementStatus(get(search), true)).status).toBe(400);
    }
    expect(mocks.port.adminRead).toHaveBeenCalledOnce();
    expect(mocks.run).not.toHaveBeenCalled();
  });
});

describe('prospective cancellation source hook', () => {
  it('passes only actor and actual canceled subscription; DB derives epoch', async () => {
    const request = post();
    expect((await managementPost(request, 'cancel')).status).toBe(200);
    expect(mocks.observation).toHaveBeenCalledExactlyOnceWith(
      { actor_id: profile.id, subscription_id: managementCanceled.id },
      request.signal,
    );
  });
  it('does not invent cancellation from an expired observation', async () => {
    mocks.port.read.mockResolvedValue({
      ok: true,
      data: { ...managementCanceled, status: 'expired' },
    });
    expect((await managementPost(post(), 'cancel')).status).toBe(200);
    expect(mocks.observation).not.toHaveBeenCalled();
  });
  it('does not observe an unconfirmed cancellation', async () => {
    mocks.port.cancel.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    mocks.port.read.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    expect((await managementPost(post(), 'cancel')).status).toBe(503);
    expect(mocks.observation).not.toHaveBeenCalled();
  });
  it('preserves observed terminal intent even when optional capture fails', async () => {
    mocks.observation.mockRejectedValue(new Error('offline'));
    expect((await managementPost(post(), 'cancel')).status).toBe(200);
    expect(mocks.port.cancel).toHaveBeenCalledOnce();
    expect(mocks.observation).toHaveBeenCalledOnce();
  });
});
