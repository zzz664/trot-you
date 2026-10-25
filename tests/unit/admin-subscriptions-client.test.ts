// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { fetchAdminSubscriptionDashboard } from '@/client/admin-subscriptions';
import {
  ADMIN_SUBSCRIPTION_ERROR_STATUS,
  ADMIN_SUBSCRIPTIONS,
} from '@/config/admin-subscriptions';
import { adminSubscriptionPath } from '@/config/routes';
import {
  subscriptionDashboard,
  subscriptionQuery,
} from './admin-subscriptions-fixtures';
afterEach(() => vi.unstubAllGlobals());
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
it('loads bounded fresh private snapshot and rejects redirects', async () => {
  const f = vi
    .fn()
    .mockResolvedValue(reply({ ok: true, data: subscriptionDashboard }));
  vi.stubGlobal('fetch', f);
  expect(await fetchAdminSubscriptionDashboard(subscriptionQuery)).toEqual({
    ok: true,
    data: subscriptionDashboard,
  });
  expect(f).toHaveBeenCalledWith(
    adminSubscriptionPath(subscriptionQuery, true),
    expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    }),
  );
});
it.each(Object.entries(ADMIN_SUBSCRIPTION_ERROR_STATUS))(
  'recognizes only matching safe %s envelope',
  async (code, status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(reply({ ok: false, code }, status)),
    );
    expect(await fetchAdminSubscriptionDashboard(subscriptionQuery)).toEqual({
      ok: false,
      code,
    });
  },
);
it.each([
  () => reply({ ok: true, data: subscriptionDashboard }, 503),
  () => reply({ ok: false, code: 'FORBIDDEN' }, 200),
  () => reply({ ok: false, code: 'PRIVATE_DETAIL' }, 400),
  () =>
    reply({ ok: true, data: { ...subscriptionDashboard, secret: 'private' } }),
  () =>
    new Response('private markup', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  () =>
    new Response('{broken', {
      headers: { 'content-type': 'application/json' },
    }),
  () =>
    new Response('x'.repeat(ADMIN_SUBSCRIPTIONS.responseMaxBytes + 1), {
      headers: { 'content-type': 'application/json' },
    }),
])('rejects malformed response %#', async (response) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
  expect(await fetchAdminSubscriptionDashboard(subscriptionQuery)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('honors an already aborted signal without a network call', async () => {
  const f = vi.fn();
  vi.stubGlobal('fetch', f);
  expect(
    await fetchAdminSubscriptionDashboard(
      subscriptionQuery,
      AbortSignal.abort(),
    ),
  ).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
  expect(f).not.toHaveBeenCalled();
});

it('validates normalized scope before transport and refuses mismatched response scope', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    reply({
      ok: true,
      data: { ...subscriptionDashboard, page: 2, artists: [] },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  expect(
    await fetchAdminSubscriptionDashboard({ ...subscriptionQuery, page: 0 }),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(fetcher).not.toHaveBeenCalled();
  expect(await fetchAdminSubscriptionDashboard(subscriptionQuery)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('sanitizes network and aborted stream failures without retry', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('private transport'));
  vi.stubGlobal('fetch', fetcher);
  expect(await fetchAdminSubscriptionDashboard(subscriptionQuery)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
