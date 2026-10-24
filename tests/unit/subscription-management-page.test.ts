// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/config/routes';
import {
  getSubscriptionsPage,
  getSubscriptionPage,
  getAdminRefundsPage,
  getAdminRefundPage,
} from '@/server/subscription-management/page';
import {
  managementIds as ids,
  managementAdmin,
  managementSubscription,
} from './management-fixtures';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  db: vi.fn(),
  cookies: vi.fn(),
  enabled: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  port: {
    list: vi.fn(),
    read: vi.fn(),
    adminList: vi.fn(),
    adminRead: vi.fn(),
  },
}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/db/subscription-management', () => ({
  createManagementDbPort: mocks.db,
}));
vi.mock('@/server/subscription-management/dependencies', () => ({
  refundExecutionEnabled: mocks.enabled,
}));
const profile = {
  id: ids.other,
  role: 'fan',
  onboarding_completed_at: '2026-10-24T12:00:00Z',
  is_restricted: false,
  restricted_until: null,
};
function context(patch: Record<string, unknown> = {}) {
  return {
    client: { actorClient: true },
    port: {
      verifySubject: vi.fn().mockResolvedValue({ ok: true, data: profile.id }),
      readProfile: vi
        .fn()
        .mockResolvedValue({ ok: true, data: { ...profile, ...patch } }),
    },
  };
}
const subscriptions = {
  subscriptions: [managementSubscription],
  page: 1,
  more_available: false,
};
const refunds = {
  requests: [managementAdmin.request],
  policy: managementAdmin.policy,
  page: 1,
  more_available: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockReturnValue(context());
  mocks.db.mockReturnValue(mocks.port);
  mocks.cookies.mockResolvedValue({
    getAll: () => [{ name: 'fictional-session', value: 'not-a-real-token' }],
  });
  mocks.enabled.mockReturnValue(false);
  mocks.port.list.mockResolvedValue({ ok: true, data: subscriptions });
  mocks.port.read.mockResolvedValue({ ok: true, data: managementSubscription });
  mocks.port.adminList.mockResolvedValue({ ok: true, data: refunds });
  mocks.port.adminRead.mockResolvedValue({ ok: true, data: managementAdmin });
});
describe('fresh server-page authority for subscription management', () => {
  it('reads exact actor-token list/detail with current cookies at each page boundary', async () => {
    expect(await getSubscriptionsPage()).toEqual({
      ok: true,
      data: subscriptions,
    });
    expect(await getSubscriptionPage(ids.subscription)).toEqual({
      ok: true,
      data: managementSubscription,
    });
    expect(mocks.cookies).toHaveBeenCalledTimes(2);
    expect(mocks.context).toHaveBeenCalledTimes(2);
    expect(mocks.context).toHaveBeenCalledWith([
      { name: 'fictional-session', value: 'not-a-real-token' },
    ]);
    expect(mocks.db).toHaveBeenCalledWith({ actorClient: true });
    expect(mocks.port.read).toHaveBeenCalledWith(ids.subscription, 1);
    expect(mocks.enabled).not.toHaveBeenCalled();
  });
  it.each([
    { is_restricted: true },
    { onboarding_completed_at: null },
    { role: 'artist' },
    { role: 'admin' },
  ])('keeps owner cancellation/read reachable under %j', async (patch) => {
    mocks.context.mockReturnValue(context(patch));
    expect((await getSubscriptionsPage()).ok).toBe(true);
    expect((await getSubscriptionPage(ids.subscription)).ok).toBe(true);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it('does not infer ownership from a valid UUID or admin role', async () => {
    mocks.port.read.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    expect(await getSubscriptionPage(ids.other)).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
  });
  it.each([getSubscriptionsPage, getAdminRefundsPage])(
    'redirects anonymous at list boundary before any database call %#',
    async (read) => {
      const ctx = context();
      ctx.port.verifySubject.mockResolvedValue({ ok: true, data: null });
      mocks.context.mockReturnValue(ctx);
      await expect(read()).rejects.toThrow(`redirect:${routes.start}`);
      expect(mocks.db).not.toHaveBeenCalled();
    },
  );
  it('redirects anonymous detail readers before loading a referenced request', async () => {
    const ctx = context();
    ctx.port.verifySubject.mockResolvedValue({ ok: true, data: null });
    mocks.context.mockReturnValue(ctx);
    await expect(getSubscriptionPage(ids.subscription)).rejects.toThrow(
      `redirect:${routes.start}`,
    );
    await expect(getAdminRefundPage(ids.request)).rejects.toThrow(
      `redirect:${routes.start}`,
    );
    expect(mocks.port.read).not.toHaveBeenCalled();
    expect(mocks.port.adminRead).not.toHaveBeenCalled();
  });
  it.each([
    [{ role: 'fan' }, routes.home],
    [{ role: 'artist' }, routes.artist],
    [{ role: 'admin', is_restricted: true }, routes.restricted],
    [{ role: 'fan', onboarding_completed_at: null }, routes.onboarding],
  ] as const)(
    'redirects unauthorized administrator %j to authoritative landing',
    async (patch, target) => {
      mocks.context.mockReturnValue(context(patch));
      await expect(getAdminRefundsPage()).rejects.toThrow(`redirect:${target}`);
      await expect(getAdminRefundPage(ids.request)).rejects.toThrow(
        `redirect:${target}`,
      );
      expect(mocks.db).not.toHaveBeenCalled();
      expect(mocks.enabled).not.toHaveBeenCalled();
    },
  );
  it('does not reuse a previous admin page decision after role revocation', async () => {
    mocks.context
      .mockReturnValueOnce(context({ role: 'admin' }))
      .mockReturnValueOnce(context({ role: 'fan' }));
    expect((await getAdminRefundsPage()).ok).toBe(true);
    await expect(getAdminRefundPage(ids.request)).rejects.toThrow(
      `redirect:${routes.home}`,
    );
    expect(mocks.port.adminList).toHaveBeenCalledOnce();
    expect(mocks.port.adminRead).not.toHaveBeenCalled();
  });
  it('returns explicit configuration/unavailable state without disclosure or fake empty success', async () => {
    mocks.context.mockReturnValue({ client: null, port: null });
    expect(await getSubscriptionsPage()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    const ctx = context();
    ctx.port.verifySubject.mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL' },
    });
    mocks.context.mockReturnValue(ctx);
    expect(await getAdminRefundsPage()).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    mocks.context.mockReturnValue({ ...context(), client: null });
    expect(await getSubscriptionPage(ids.subscription)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it('validates paging/UUID before data access and rejects mismatched returned detail identity', async () => {
    expect(await getSubscriptionsPage(0)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(await getSubscriptionPage('bad')).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(mocks.port.list).not.toHaveBeenCalled();
    expect(mocks.port.read).not.toHaveBeenCalled();
    mocks.port.read.mockResolvedValue({
      ok: true,
      data: { ...managementSubscription, id: ids.other },
    });
    expect(await getSubscriptionPage(ids.subscription)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('renders admin data with an explicit execution gate, never as business approval', async () => {
    mocks.context.mockReturnValue(context({ role: 'admin' }));
    expect(await getAdminRefundsPage()).toEqual({ ok: true, data: refunds });
    const result = await getAdminRefundPage(ids.request);
    expect(result).toMatchObject({
      ok: true,
      data: {
        execution_enabled: false,
        can_execute: false,
        policy: managementAdmin.policy,
      },
    });
    expect(mocks.port.adminRead).toHaveBeenCalledExactlyOnceWith(ids.request);
  });
});
