import {
  ANALYTICS_FUNNEL_EVENTS,
  type AnalyticsFunnelDashboard,
  type AnalyticsFunnelQuery,
} from '@/config/analytics-funnel';
export const funnelActor = '39000000-0000-4000-8000-000000000001';
export const funnelOther = '39000000-0000-4000-8000-000000000002';
export const funnelQuery: AnalyticsFunnelQuery = {
  from: '2026-10-01',
  to: '2026-10-25',
};
export const funnelDashboard: AnalyticsFunnelDashboard = {
  actor_id: funnelActor,
  as_of: '2026-10-26T06:00:00.123456+00:00',
  ...funnelQuery,
  window_start: '2026-09-30T15:00:00Z',
  window_end: '2026-10-25T15:00:00Z',
  time_zone: 'Asia/Seoul',
  collection: { status: 'enabled', retention_days: 90 },
  coverage: {
    instrumentation_from: '2026-10-01T00:00:00Z',
    history_complete: false,
    mode: 'current_consent_observations',
  },
  events: ANALYTICS_FUNNEL_EVENTS.map((name, index) => ({
    name,
    event_count: index + 1,
  })),
  daily: ANALYTICS_FUNNEL_EVENTS.map((name, index) => ({
    day_kst: '2026-10-25',
    name,
    event_count: index + 1,
  })),
  business_metrics: {
    configured: false,
    reason: 'definitions_unapproved',
    expected_count: 4,
  },
};
export function unavailableFunnel(
  status: 'unconfigured' | 'disabled' = 'unconfigured',
): AnalyticsFunnelDashboard {
  return {
    ...funnelDashboard,
    collection: {
      status,
      retention_days: status === 'unconfigured' ? null : 90,
    },
    events: funnelDashboard.events.map((event) => ({
      ...event,
      event_count: null,
    })),
    daily: [],
  };
}
