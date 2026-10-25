// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createAdminSubscriptionPort } from '@/server/db/admin-subscriptions';
import type { ActorClient } from '@/server/db/client';
import {
  subscriptionQuery,
  subscriptionDashboard,
  subscriptionArtist,
} from './admin-subscriptions-fixtures';
function client(result: unknown) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as ActorClient, rpc };
}
it('requests only bounded actor-scoped aggregate RPC with no fan or credential lookup', async () => {
  const c = client({ data: subscriptionDashboard, error: null });
  expect(
    await createAdminSubscriptionPort(c.client).read(subscriptionQuery),
  ).toEqual({ ok: true, data: subscriptionDashboard });
  expect(c.rpc).toHaveBeenCalledExactlyOnceWith(
    'admin_subscription_dashboard',
    {
      p_from: subscriptionQuery.from,
      p_to: subscriptionQuery.to,
      p_page: 1,
    },
  );
});
it.each([
  ['FORBIDDEN', 'FORBIDDEN'],
  ['INVALID_INPUT', 'INVALID_INPUT'],
  ['NOT_FOUND', 'NOT_FOUND'],
  ['ISOLATION_UNSUPPORTED', 'UNAVAILABLE'],
  ['secret', 'UNAVAILABLE'],
])('sanitizes %s as %s', async (input, code) => {
  expect(
    await createAdminSubscriptionPort(
      client({ data: null, error: { message: `ADMIN_SUBSCRIPTIONS_${input}` } })
        .client,
    ).read(subscriptionQuery),
  ).toEqual({ ok: false, code });
});
it.each([
  null,
  {},
  [],
  { ...subscriptionDashboard, secret: 'hidden' },
  { ...subscriptionDashboard, page: 2, artists: [] },
  {
    ...subscriptionDashboard,
    from: '2026-10-02',
    window_start: '2026-10-01T15:00:00Z',
  },
  {
    ...subscriptionDashboard,
    selected_artist: {
      id: subscriptionArtist,
      slug: 'fictional-artist',
      name: '가상 가수',
      status: 'active',
    },
  },
])('rejects malformed or mismatched projection %#', async (data) => {
  expect(
    await createAdminSubscriptionPort(
      client({ data, error: null }).client,
    ).read(subscriptionQuery),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
