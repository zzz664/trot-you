// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelSubscription,
  readSubscription,
  requestRefund,
} from '@/client/subscription';
import {
  authorizeRefund,
  executeRefund,
  readAdminRefund,
  reconcileRefund,
  rejectRefund,
} from '@/client/refunds';
import {
  MANAGEMENT_ERROR_STATUS,
  MANAGEMENT_RESPONSE_MAX_BYTES,
} from '@/config/subscription-management';
import { routes } from '@/config/routes';
import {
  managementAdmin,
  managementAuthorized,
  managementCanceled,
  managementIds as ids,
  managementSubscription,
} from './management-fixtures';

const fetcher = vi.fn<typeof fetch>();
const refundInput = {
  subscriptionId: ids.subscription,
  originalEventId: ids.charge,
  amountKrw: 500,
  reason: '검토 요청',
  idempotencyKey: ids.key,
};
const approvalInput = {
  requestId: ids.request,
  amountKrw: 500,
  policyVersion: ids.policy,
  reason: '정책 검토 완료',
  accepted: true as const,
};
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());

describe('subscription/refund browser transport is read-only until an explicit command', () => {
  it('reads exact subscription/page without mutation, redirects or cache', async () => {
    fetcher.mockImplementation(async () =>
      response({ ok: true, data: { ...managementSubscription, page: 2 } }),
    );
    expect(
      await readSubscription({ subscriptionId: ids.subscription }, 2),
    ).toMatchObject({ ok: true, data: { page: 2 } });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `${routes.subscriptionStatus}?subscription=${ids.subscription}&page=2`,
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      }),
    );
    expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty('body');
  });
  it.each([0, -1, 1.5, Number.NaN, 10001])(
    'rejects malformed page %s before network',
    async (page) => {
      expect(
        await readSubscription({ subscriptionId: ids.subscription }, page),
      ).toEqual({ ok: false, code: 'INVALID_INPUT' });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it('rejects malformed UUID before every mutation/read', async () => {
    expect(await readSubscription({ subscriptionId: 'bad' })).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(await cancelSubscription({ subscriptionId: 'bad' })).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(await executeRefund({ requestId: 'bad' })).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(await readAdminRefund({ requestId: 'bad' })).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('cancels once with exact owner-bound ID and requires canceled/expired response', async () => {
    fetcher.mockImplementation(async () =>
      response({ ok: true, data: managementCanceled }),
    );
    expect(
      await cancelSubscription({ subscriptionId: ids.subscription }),
    ).toEqual({ ok: true, data: managementCanceled });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      routes.subscriptionCancel,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ subscriptionId: ids.subscription }),
        credentials: 'same-origin',
      }),
    );
    fetcher.mockImplementation(async () =>
      response({ ok: true, data: managementSubscription }),
    );
    expect(
      await cancelSubscription({ subscriptionId: ids.subscription }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('preserves fan request exact amount and idempotency key, never auto-cancels', async () => {
    fetcher.mockImplementation(async () =>
      response({ ok: true, data: managementSubscription }),
    );
    expect(await requestRefund(refundInput)).toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      routes.refundRequest,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(refundInput),
      }),
    );
  });
  it.each([0, -1, 1.5, Number.NaN])(
    'rejects nonpositive/noninteger request amount %s',
    async (amountKrw) => {
      expect(await requestRefund({ ...refundInput, amountKrw })).toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each(['', ' ', 'x'.repeat(501)])(
    'rejects absent/overlong reason before network',
    async (reason) => {
      expect(await requestRefund({ ...refundInput, reason })).toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
      expect(await authorizeRefund({ ...approvalInput, reason })).toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
      expect(await rejectRefund({ requestId: ids.request, reason })).toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it('authorization requires explicit acknowledgment and sends no execution request', async () => {
    // Simulates an untrusted caller bypassing TypeScript.
    expect(
      await authorizeRefund({ ...approvalInput, accepted: false } as never),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockImplementation(async () =>
      response({ ok: true, data: managementAuthorized }),
    );
    expect(await authorizeRefund(approvalInput)).toEqual({
      ok: true,
      data: managementAuthorized,
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      routes.refundAuthorize,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(approvalInput),
      }),
    );
  });
  it.each([
    { amount_krw: 600 },
    { policy_version: ids.other },
    { status: 'requested' },
  ])('rejects mismatched authorization reply %j', async (patch) => {
    fetcher.mockImplementation(async () =>
      response({
        ok: true,
        data: {
          ...managementAuthorized,
          request: { ...managementAuthorized.request, ...patch },
        },
      }),
    );
    expect(await authorizeRefund(approvalInput)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('allows only exact requested admin detail and rejected state', async () => {
    fetcher.mockImplementation(async () =>
      response({ ok: true, data: managementAdmin }),
    );
    expect(await readAdminRefund({ requestId: ids.request })).toEqual({
      ok: true,
      data: managementAdmin,
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `${routes.adminRefundStatus}?request=${ids.request}`,
    );
    expect(
      await rejectRefund({ requestId: ids.request, reason: '검토 거절' }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
    fetcher.mockImplementation(async () =>
      response({
        ok: true,
        data: {
          ...managementAdmin,
          request: { ...managementAdmin.request, status: 'rejected' },
        },
      }),
    );
    expect(
      await rejectRefund({ requestId: ids.request, reason: '검토 거절' }),
    ).toMatchObject({ ok: true });
  });
  it('unknown refund is not success money and never causes automatic redispatch', async () => {
    const data = {
      ...managementAuthorized,
      can_execute: false,
      can_reconcile: true,
      request: {
        ...managementAuthorized.request,
        status: 'unknown',
        can_reconcile: true,
      },
    };
    fetcher.mockImplementation(async () => response({ ok: true, data }));
    expect(await executeRefund({ requestId: ids.request })).toEqual({
      ok: true,
      data,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await reconcileRefund({ requestId: ids.request })).toEqual({
      ok: true,
      data,
    });
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      routes.refundExecute,
      routes.refundReconcile,
    ]);
  });
  it('rejects another subscription or wrong read page even in a valid JSON schema', async () => {
    fetcher.mockImplementation(async () =>
      response({
        ok: true,
        data: { ...managementSubscription, id: ids.other },
      }),
    );
    expect(await requestRefund(refundInput)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    fetcher.mockImplementation(async () =>
      response({ ok: true, data: managementSubscription }),
    );
    expect(
      await readSubscription({ subscriptionId: ids.subscription }, 2),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('rejects another admin request across every admin entrypoint', async () => {
    fetcher.mockImplementation(async () =>
      response({
        ok: true,
        data: {
          ...managementAuthorized,
          request: { ...managementAuthorized.request, id: ids.other },
        },
      }),
    );
    expect(await readAdminRefund({ requestId: ids.request })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(await authorizeRefund(approvalInput)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(await executeRefund({ requestId: ids.request })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(await reconcileRefund({ requestId: ids.request })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it.each(Object.keys(MANAGEMENT_ERROR_STATUS))(
    'allows safe enumerated error %s without provider text',
    async (code) => {
      fetcher.mockImplementation(async () =>
        response({ ok: false, code }, 409),
      );
      expect(await executeRefund({ requestId: ids.request })).toEqual({
        ok: false,
        code,
      });
    },
  );
  it.each([
    () => response({ ok: false, code: 'RAW_PROVIDER_SECRET' }),
    () => response({ ok: true, data: managementSubscription }, 500),
    () =>
      new Response('<html>login</html>', {
        headers: { 'content-type': 'text/html' },
      }),
    () =>
      new Response('{', { headers: { 'content-type': 'application/json' } }),
    () =>
      response({
        ok: true,
        data: { ...managementSubscription, status: 'invented-success' },
      }),
    () => response({ ok: true, data: null }),
    () =>
      new Response(new Uint8Array([0xff]), {
        headers: { 'content-type': 'application/json' },
      }),
  ])(
    'fails closed on malformed/hostile transport without a retry',
    async (makeResponse) => {
      fetcher.mockResolvedValue(makeResponse());
      expect(
        await readSubscription({ subscriptionId: ids.subscription }),
      ).toEqual({ ok: false, code: 'UNAVAILABLE' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it('bounds streamed response bytes', async () => {
    fetcher.mockResolvedValue(
      new Response(' '.repeat(MANAGEMENT_RESPONSE_MAX_BYTES + 1), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(
      await readSubscription({ subscriptionId: ids.subscription }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('network failure remains unknown and never automatically replays a write', async () => {
    fetcher.mockRejectedValue(new Error('provider details must not escape'));
    expect(await executeRefund({ requestId: ids.request })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('strips non-public unknown fields from valid response shapes', async () => {
    fetcher.mockImplementation(async () =>
      response({
        ok: true,
        data: { ...managementSubscription, providerPaymentId: 'sensitive' },
      }),
    );
    expect(
      await readSubscription({ subscriptionId: ids.subscription }),
    ).toEqual({ ok: true, data: managementSubscription });
  });
});
