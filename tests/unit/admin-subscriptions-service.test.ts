// @vitest-environment node
import { expect, it, vi } from 'vitest';
import {
  ADMIN_SUBSCRIPTIONS,
  adminSubscriptionQuerySchema,
  adminSubscriptionDashboardSchema,
  adminSubscriptionPeriodSchema,
} from '@/config/admin-subscriptions';
import {
  resolveAdminSubscriptionQuery,
  getAdminSubscriptionDashboard,
  type AdminSubscriptionPort,
} from '@/server/services/admin-subscriptions/read';
import {
  subscriptionQuery,
  subscriptionDashboard,
} from './admin-subscriptions-fixtures';
const now = new Date('2026-10-25T14:59:59Z');
it('defaults last30 KST calendar days including today at exact midnight boundary', () => {
  expect(resolveAdminSubscriptionQuery({}, now)).toEqual({
    ok: true,
    data: { from: '2026-09-26', to: '2026-10-25', artist_id: null, page: 1 },
  });
  expect(
    resolveAdminSubscriptionQuery({}, new Date('2026-10-25T15:00:00Z')),
  ).toEqual({
    ok: true,
    data: { from: '2026-09-27', to: '2026-10-26', artist_id: null, page: 1 },
  });
});
it('accepts full bounded leap-year range and rejects day367', () => {
  expect(
    resolveAdminSubscriptionQuery({ from: '2024-01-01', to: '2024-12-31' }, now)
      .ok,
  ).toBe(true);
  expect(
    resolveAdminSubscriptionQuery({ from: '2024-01-01', to: '2025-01-01' }, now)
      .ok,
  ).toBe(false);
});
it.each([
  null,
  [],
  {},
  'bad',
  { from: '2026-10-01' },
  { to: '2026-10-25' },
  { from: '2026-10-26', to: '2026-10-26' },
  { from: '2026-10-25', to: '2026-10-24' },
  { from: '1999-12-31', to: '2000-01-01' },
  { from: '2026-02-29', to: '2026-03-01' },
  { page: '0' },
  { page: '01' },
  { page: '1001' },
  { page: 1 },
  { page: ['1', '2'] },
  { actor_id: 'forged' },
  { artist_id: 'not-uuid' },
  { artist_id: '' },
])('rejects malformed raw query %#', (input) => {
  if (
    input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    Object.keys(input).length === 0
  )
    return;
  expect(resolveAdminSubscriptionQuery(input, now)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
});
it('accepts bounded page and artist UUID without an actor override', () => {
  expect(
    resolveAdminSubscriptionQuery(
      {
        page: String(ADMIN_SUBSCRIPTIONS.maxPage),
        artist_id: 'a3000000-0000-4000-8000-000000000002',
      },
      now,
    ),
  ).toMatchObject({
    ok: true,
    data: { page: 1000, artist_id: 'a3000000-0000-4000-8000-000000000002' },
  });
  expect(resolveAdminSubscriptionQuery({}, new Date('invalid'))).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
});
it('only reads validated scope once and sanitizes errors', async () => {
  const port: AdminSubscriptionPort = {
    read: vi.fn().mockResolvedValue({ ok: true, data: subscriptionDashboard }),
  };
  expect(await getAdminSubscriptionDashboard(port, subscriptionQuery)).toEqual({
    ok: true,
    data: subscriptionDashboard,
  });
  expect(port.read).toHaveBeenCalledExactlyOnceWith(subscriptionQuery);
  expect(
    await getAdminSubscriptionDashboard(port, {
      ...subscriptionQuery,
      role: 'admin',
    }),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(port.read).toHaveBeenCalledTimes(1);
  vi.mocked(port.read).mockRejectedValue(new Error('private details'));
  expect(await getAdminSubscriptionDashboard(port, subscriptionQuery)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('requires exact partition, dedup count, rate and KST boundaries', () => {
  expect(
    adminSubscriptionDashboardSchema.safeParse(subscriptionDashboard).success,
  ).toBe(true);
  for (const data of [
    { ...subscriptionDashboard, secret: 'hidden' },
    { ...subscriptionDashboard, window_start: '2026-10-01T00:00:00Z' },
    { ...subscriptionDashboard, window_end: '2026-10-26T00:00:00Z' },
    { ...subscriptionDashboard, time_zone: 'UTC' },
    { ...subscriptionDashboard, has_more: true },
    { ...subscriptionDashboard, total_artists: 2 },
    {
      ...subscriptionDashboard,
      artists: [
        subscriptionDashboard.artists[0],
        subscriptionDashboard.artists[0],
      ],
      total_artists: 2,
    },
    {
      ...subscriptionDashboard,
      summary: {
        ...subscriptionDashboard.summary,
        current: {
          ...subscriptionDashboard.summary.current,
          total_subscriptions: 7,
        },
      },
    },
    {
      ...subscriptionDashboard,
      summary: {
        ...subscriptionDashboard.summary,
        current: { ...subscriptionDashboard.summary.current, subscribers: 5 },
      },
    },
    {
      ...subscriptionDashboard,
      summary: {
        ...subscriptionDashboard.summary,
        period: { ...subscriptionDashboard.summary.period, renewal_rate: 99 },
      },
    },
    {
      ...subscriptionDashboard,
      summary: {
        ...subscriptionDashboard.summary,
        period: {
          ...subscriptionDashboard.summary.period,
          renewal_due: 0,
          renewal_paid: 0,
          renewal_rate: 0,
        },
      },
    },
    {
      ...subscriptionDashboard,
      artists: [{ ...subscriptionDashboard.artists[0], fan_email: 'private' }],
    },
  ])
    expect(adminSubscriptionDashboardSchema.safeParse(data).success).toBe(
      false,
    );
  expect(
    adminSubscriptionQuerySchema.safeParse({ ...subscriptionQuery, page: 1.1 })
      .success,
  ).toBe(false);
});
it('accepts zero denominator as unavailable, not a manufactured zero percentage', () => {
  const empty = {
    ...subscriptionDashboard,
    summary: {
      ...subscriptionDashboard.summary,
      period: {
        new_subscriptions: 0,
        cancellations: 0,
        renewal_due: 0,
        renewal_paid: 0,
        renewal_rate: null,
      },
    },
  };
  expect(adminSubscriptionDashboardSchema.safeParse(empty).success).toBe(true);
});

it.each([
  [57, 800, 7.13],
  [3, 20000, 0.02],
  [0, Number.MAX_SAFE_INTEGER, 0],
  [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 100],
])(
  'validates PostgreSQL decimal half-up rate %s/%s exactly',
  (paid, due, rate) => {
    expect(
      adminSubscriptionPeriodSchema.safeParse({
        new_subscriptions: 0,
        cancellations: 0,
        renewal_due: due,
        renewal_paid: paid,
        renewal_rate: rate,
      }).success,
    ).toBe(true);
  },
);
