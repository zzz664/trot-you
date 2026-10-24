// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adminRefundDetail,
  authorizeRefund,
  cancelSubscription,
  listAdminRefunds,
  listSubscriptions,
  readAdminRefund,
  readSubscription,
  rejectRefund,
  requestRefund,
} from '@/server/services/subscription/manage';
import type { ManagementDbPort } from '@/server/services/subscription/management-model';
import {
  managementAdmin as admin,
  managementAuthorized as authorized,
  managementCanceled as canceled,
  managementIds as id,
  managementRequest as refund,
  managementSubscription as subscription,
} from './management-fixtures';
const ok = <T>(data: T) => ({ ok: true as const, data });
const unavailable = { ok: false as const, code: 'UNAVAILABLE' as const };
const port = {
  list: vi.fn(),
  read: vi.fn(),
  cancel: vi.fn(),
  request: vi.fn(),
  adminList: vi.fn(),
  adminRead: vi.fn(),
  authorize: vi.fn(),
  reject: vi.fn(),
} satisfies ManagementDbPort;
const requestInput = {
  subscriptionId: id.subscription,
  originalEventId: id.charge,
  amountKrw: refund.amount_krw,
  reason: refund.reason,
  idempotencyKey: id.key,
};
const approveInput = {
  requestId: id.request,
  amountKrw: refund.amount_krw,
  policyVersion: id.policy,
  reason: 'Verified case',
  accepted: true as const,
};
beforeEach(() => {
  vi.resetAllMocks();
  port.list.mockResolvedValue(
    ok({ subscriptions: [subscription], page: 1, more_available: false }),
  );
  port.read.mockResolvedValue(ok(subscription));
  port.cancel.mockResolvedValue(ok(null));
  port.request.mockResolvedValue(ok(refund));
  port.adminList.mockResolvedValue(
    ok({
      requests: [refund],
      page: 1,
      more_available: false,
      policy: admin.policy,
    }),
  );
  port.adminRead.mockResolvedValue(ok(admin));
  port.authorize.mockResolvedValue(ok(authorized.request));
  port.reject.mockResolvedValue(ok({ ...refund, status: 'rejected' }));
});
describe('owner management service', () => {
  it.each([undefined, 1, '1'])(
    'validates page %# and uses actor-scoped list',
    async (page) => {
      expect((await listSubscriptions(port, page)).ok).toBe(true);
      expect(port.list).toHaveBeenCalledExactlyOnceWith(1);
    },
  );
  it.each([0, -1, true, null, [], {}, '1.2', 1.2, 10001, '1e1', '01', ''])(
    'rejects invalid page %#',
    async (page) => {
      expect(await listSubscriptions(port, page)).toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
      expect(port.list).not.toHaveBeenCalled();
    },
  );
  it('checks response page and subscription identity', async () => {
    port.list.mockResolvedValue(
      ok({ subscriptions: [], page: 2, more_available: false }),
    );
    expect(await listSubscriptions(port)).toEqual(unavailable);
    port.read.mockResolvedValue(ok({ ...subscription, id: id.other }));
    expect(
      await readSubscription(port, { subscriptionId: id.subscription }),
    ).toEqual(unavailable);
    port.read.mockResolvedValue(ok({ ...subscription, page: 2 }));
    expect(
      await readSubscription(port, { subscriptionId: id.subscription }),
    ).toEqual(unavailable);
  });
  it.each([
    null,
    {},
    { subscriptionId: 'bad' },
    { subscriptionId: id.subscription, actorId: id.other },
  ])('rejects malformed read/cancel %#', async (input) => {
    expect(await readSubscription(port, input)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(await cancelSubscription(port, input)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(port.cancel).not.toHaveBeenCalled();
  });
  it.each(['canceled', 'expired'] as const)(
    'confirms only persisted %s intent, not immediate access termination',
    async (status) => {
      port.read.mockResolvedValue(
        ok({ ...canceled, status, has_access: true }),
      );
      expect(
        await cancelSubscription(port, { subscriptionId: id.subscription }),
      ).toEqual(ok({ ...canceled, status, has_access: true }));
      expect(port.cancel).toHaveBeenCalledExactlyOnceWith(id.subscription);
      expect(port.request).not.toHaveBeenCalled();
    },
  );
  it('observes cancellation after a lost mutation response without replay', async () => {
    port.cancel.mockResolvedValue(unavailable);
    port.read.mockResolvedValue(ok(canceled));
    expect(
      (await cancelSubscription(port, { subscriptionId: id.subscription })).ok,
    ).toBe(true);
    expect(port.cancel).toHaveBeenCalledOnce();
  });
  it('does not call active state a successful cancellation', async () => {
    expect(
      await cancelSubscription(port, { subscriptionId: id.subscription }),
    ).toEqual(unavailable);
  });
  it('does not hide forbidden cancellation behind an extra read', async () => {
    port.cancel.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    expect(
      await cancelSubscription(port, { subscriptionId: id.subscription }),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(port.read).not.toHaveBeenCalled();
  });
  it('requests exact reviewed money without charging or canceling', async () => {
    expect(await requestRefund(port, requestInput)).toEqual(ok(subscription));
    expect(port.request).toHaveBeenCalledExactlyOnceWith(requestInput);
    expect(port.cancel).not.toHaveBeenCalled();
    expect(port.authorize).not.toHaveBeenCalled();
  });
  it.each([
    { amountKrw: 0 },
    { amountKrw: 0.5 },
    { reason: ' \n\t\u00a0\ufeff' },
    { idempotencyKey: 'bad' },
    { provider: 'toss' },
  ])('rejects invalid request %#', async (change) => {
    expect(await requestRefund(port, { ...requestInput, ...change })).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(port.request).not.toHaveBeenCalled();
  });
  it.each([
    { subscription_id: id.other },
    { original_event_id: id.other },
    { amount_krw: 499 },
    { reason: 'wrong reason' },
  ])('never accepts a mismatched persisted request %#', async (change) => {
    port.request.mockResolvedValue(ok({ ...refund, ...change }));
    expect(await requestRefund(port, requestInput)).toEqual(unavailable);
    expect(port.read).not.toHaveBeenCalled();
  });
});
describe('explicit manual refund review service', () => {
  it('does not invent policy or imply enabled execution is authorization', () => {
    const data = adminRefundDetail({ request: refund, policy: null }, true);
    expect(data.can_authorize).toBe(false);
    expect(data.can_execute).toBe(false);
    expect(data.can_reject).toBe(true);
  });
  it.each([false, true])(
    'keeps query independent of dispatch enablement %s',
    (enabled) => {
      const request = {
        ...authorized.request,
        status: 'unknown' as const,
        can_reconcile: true,
      };
      const data = adminRefundDetail({ request, policy: null }, enabled);
      expect(data.can_reconcile).toBe(true);
      expect(data.can_execute).toBe(false);
      expect(data.can_reject).toBe(false);
    },
  );
  it('does not execute revoked/manual-review authorization or stale policy', () => {
    expect(
      adminRefundDetail(
        {
          ...authorized,
          request: { ...authorized.request, requires_manual_review: true },
        },
        true,
      ).can_execute,
    ).toBe(false);
    expect(
      adminRefundDetail({ ...authorized, policy: null }, true).can_execute,
    ).toBe(false);
    expect(
      adminRefundDetail(
        { ...authorized, policy: { ...admin.policy!, version: id.other } },
        true,
      ).can_execute,
    ).toBe(false);
    expect(adminRefundDetail(authorized, false).can_execute).toBe(false);
  });
  it('requires explicit policy acceptance and exact request identity', async () => {
    expect(
      await authorizeRefund(port, { ...approveInput, accepted: false }, true),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    port.adminRead.mockResolvedValue(ok(authorized));
    expect((await authorizeRefund(port, approveInput, true)).ok).toBe(true);
    expect(port.authorize).toHaveBeenCalledExactlyOnceWith(approveInput);
  });
  it.each([
    { id: id.other },
    { status: 'requested' },
    { amount_krw: 499 },
    { policy_version: id.other },
  ])('rejects ambiguous authorization %#', async (change) => {
    port.authorize.mockResolvedValue(ok({ ...authorized.request, ...change }));
    expect(await authorizeRefund(port, approveInput, true)).toEqual(
      unavailable,
    );
  });
  it('rejects only after persisted rejection', async () => {
    port.adminRead.mockResolvedValue(
      ok({ ...admin, request: { ...refund, status: 'rejected' } }),
    );
    const result = await rejectRefund(
      port,
      { requestId: id.request, reason: 'Not approved' },
      true,
    );
    expect(result.ok && result.data.request.status).toBe('rejected');
    expect(port.authorize).not.toHaveBeenCalled();
  });
  it('checks admin read/list identity and page', async () => {
    port.adminRead.mockResolvedValue(
      ok({ ...admin, request: { ...refund, id: id.other } }),
    );
    expect(
      await readAdminRefund(port, { requestId: id.request }, false),
    ).toEqual(unavailable);
    port.adminList.mockResolvedValue(
      ok({ requests: [], page: 2, more_available: false, policy: null }),
    );
    expect(await listAdminRefunds(port)).toEqual(unavailable);
  });
  it.each([
    'list',
    'read',
    'cancel',
    'request',
    'adminList',
    'adminRead',
    'authorize',
    'reject',
  ] as const)('fails %s transport exceptions closed', async (method) => {
    port[method].mockRejectedValue(new Error('private provider data'));
    const actions = {
      list: () => listSubscriptions(port),
      read: () => readSubscription(port, { subscriptionId: id.subscription }),
      cancel: () =>
        cancelSubscription(port, { subscriptionId: id.subscription }),
      request: () => requestRefund(port, requestInput),
      adminList: () => listAdminRefunds(port),
      adminRead: () => readAdminRefund(port, { requestId: id.request }, true),
      authorize: () => authorizeRefund(port, approveInput, true),
      reject: () =>
        rejectRefund(port, { requestId: id.request, reason: 'No' }, true),
    };
    expect(await actions[method]()).toEqual(unavailable);
  });
});
