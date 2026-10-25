import type {
  AdminSubscriptionDashboard,
  AdminSubscriptionQuery,
} from '@/config/admin-subscriptions';
export const subscriptionActor = 'a3000000-0000-4000-8000-000000000001';
export const subscriptionArtist = 'a3000000-0000-4000-8000-000000000002';
export const subscriptionQuery: AdminSubscriptionQuery = {
  from: '2026-10-01',
  to: '2026-10-25',
  artist_id: null,
  page: 1,
};
export const subscriptionCurrent = {
  total_subscriptions: 8,
  subscribers: 3,
  active_paid: 2,
  grace: 1,
  canceled_paid: 1,
  pending: 1,
  expired: 1,
  out_of_access: 2,
};
export const subscriptionPeriod = {
  new_subscriptions: 2,
  cancellations: 1,
  renewal_due: 3,
  renewal_paid: 1,
  renewal_rate: 33.33,
};
export const subscriptionDashboard: AdminSubscriptionDashboard = {
  as_of: '2026-10-25T10:00:00Z',
  from: subscriptionQuery.from,
  to: subscriptionQuery.to,
  window_start: '2026-09-30T15:00:00Z',
  window_end: '2026-10-25T15:00:00Z',
  time_zone: 'Asia/Seoul',
  cancellation_history_complete_from: '2026-10-25T01:00:00Z',
  selected_artist: null,
  summary: { current: subscriptionCurrent, period: subscriptionPeriod },
  artists: [
    {
      id: subscriptionArtist,
      slug: 'fictional-artist',
      name: '가상 가수',
      status: 'active',
      current: subscriptionCurrent,
      period: subscriptionPeriod,
    },
  ],
  page: 1,
  page_size: 20,
  total_artists: 1,
  has_more: false,
};
