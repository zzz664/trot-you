// @vitest-environment node
import { expect, it, vi } from 'vitest';
import {
  ANALYTICS_FUNNEL,
  analyticsFunnelDashboardSchema,
  analyticsFunnelQuerySchema,
} from '@/config/analytics-funnel';
import {
  getAnalyticsFunnelDashboard,
  resolveAnalyticsFunnelQuery,
} from '@/server/services/analytics-funnel/read';
import * as f from './analytics-funnel-fixtures';
const now = new Date('2026-10-26T14:59:59Z');
it('resolves a thirty-day inclusive KST default without a business conversion definition', () => {
  expect(resolveAnalyticsFunnelQuery({}, now)).toEqual({
    ok: true,
    data: { from: '2026-09-27', to: '2026-10-26' },
  });
  expect(
    resolveAnalyticsFunnelQuery({}, new Date('2026-10-26T15:00:00Z')),
  ).toEqual({ ok: true, data: { from: '2026-09-28', to: '2026-10-27' } });
});
it.each([
  null,
  [],
  { from: '2026-10-01' },
  { to: '2026-10-25' },
  { actor_id: f.funnelActor },
  { from: ['2026-10-01'], to: '2026-10-25' },
  { from: '2026-02-30', to: '2026-10-25' },
  { from: '', to: '' },
  { from: '2026-10-25', to: '2026-10-01' },
  { from: '1999-12-31', to: '2000-01-01' },
  { from: '2025-10-25', to: '2026-10-26' },
  { from: '2026-10-26', to: '2026-10-27' },
])('rejects invalid/unbounded/forged query %#', (input) =>
  expect(resolveAnalyticsFunnelQuery(input, now)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  }),
);
it('invalid clocks fail closed', () =>
  expect(resolveAnalyticsFunnelQuery({}, new Date('bad'))).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  }));
it.each([
  { from: '2025-10-26', to: '2026-10-26' },
  { from: '2026-10-26', to: '2026-10-26' },
  { from: '2024-02-29', to: '2024-02-29' },
])('accepts bounded inclusive calendar dates %j', (query) =>
  expect(resolveAnalyticsFunnelQuery(query, now)).toEqual({
    ok: true,
    data: query,
  }),
);
it('accepts complete raw aggregates with thirteen events and explicit missing metrics', () =>
  expect(
    analyticsFunnelDashboardSchema.safeParse(f.funnelDashboard).success,
  ).toBe(true));
it.each(['unconfigured', 'disabled'] as const)(
  'preserves %s null counts instead of zero',
  (status) =>
    expect(
      analyticsFunnelDashboardSchema.safeParse(f.unavailableFunnel(status))
        .success,
    ).toBe(true),
);
it('accepts actual empty observation history while enabled', () =>
  expect(
    analyticsFunnelDashboardSchema.safeParse({
      ...f.funnelDashboard,
      daily: [],
      events: f.funnelDashboard.events.map((event) => ({
        ...event,
        event_count: 0,
      })),
    }).success,
  ).toBe(true));
const malformed = [
  null,
  {},
  { ...f.funnelDashboard, source_id: f.funnelOther },
  { ...f.funnelDashboard, actor_id: 'bad' },
  { ...f.funnelDashboard, time_zone: 'UTC' },
  { ...f.funnelDashboard, window_start: '2026-10-01T00:00:00Z' },
  { ...f.funnelDashboard, window_end: '2026-10-25T00:00:00Z' },
  { ...f.funnelDashboard, as_of: '2026-09-30T00:00:00Z' },
  {
    ...f.funnelDashboard,
    coverage: { ...f.funnelDashboard.coverage, history_complete: true },
  },
  {
    ...f.funnelDashboard,
    coverage: {
      ...f.funnelDashboard.coverage,
      instrumentation_from: '2099-01-01T00:00:00Z',
    },
  },
  {
    ...f.funnelDashboard,
    business_metrics: {
      configured: true,
      reason: 'definitions_unapproved',
      expected_count: 4,
    },
  },
  {
    ...f.funnelDashboard,
    business_metrics: {
      ...f.funnelDashboard.business_metrics,
      expected_count: 3,
    },
  },
  { ...f.funnelDashboard, events: f.funnelDashboard.events.slice(1) },
  {
    ...f.funnelDashboard,
    events: f.funnelDashboard.events.map(() => f.funnelDashboard.events[0]),
  },
  {
    ...f.funnelDashboard,
    events: f.funnelDashboard.events.map((event) => ({
      ...event,
      event_count: 2,
    })),
  },
  {
    ...f.funnelDashboard,
    daily: [...f.funnelDashboard.daily, f.funnelDashboard.daily[0]],
  },
  {
    ...f.funnelDashboard,
    daily: f.funnelDashboard.daily.map((row) => ({
      ...row,
      day_kst: '2026-10-26',
    })),
  },
  {
    ...f.funnelDashboard,
    daily: f.funnelDashboard.daily.map((row) => ({ ...row, event_count: 0 })),
  },
  {
    ...f.funnelDashboard,
    daily: f.funnelDashboard.daily.map((row) => ({
      ...row,
      event_count: Number.MAX_SAFE_INTEGER + 1,
    })),
  },
  {
    ...f.funnelDashboard,
    collection: { status: 'enabled', retention_days: null },
  },
  {
    ...f.funnelDashboard,
    collection: { status: 'enabled', retention_days: 0 },
  },
  {
    ...f.funnelDashboard,
    collection: { status: 'enabled', retention_days: 3651 },
  },
  { ...f.unavailableFunnel(), events: f.funnelDashboard.events },
  { ...f.unavailableFunnel('disabled'), daily: f.funnelDashboard.daily },
  {
    ...f.unavailableFunnel(),
    collection: { status: 'unconfigured', retention_days: 30 },
  },
];
it.each(malformed)(
  'rejects inconsistent, identifying or invented aggregate %#',
  (value) =>
    expect(analyticsFunnelDashboardSchema.safeParse(value).success).toBe(false),
);
it('uses bigint sums to reject over-safe totals rather than rounded arithmetic', () => {
  const name = f.funnelDashboard.events[0]!.name;
  const data = {
    ...f.funnelDashboard,
    events: f.funnelDashboard.events.map((event, index) => ({
      ...event,
      event_count: index === 0 ? Number.MAX_SAFE_INTEGER : 0,
    })),
    daily: [
      { name, day_kst: '2026-10-24', event_count: Number.MAX_SAFE_INTEGER },
      { name, day_kst: '2026-10-25', event_count: 1 },
    ],
  };
  expect(analyticsFunnelDashboardSchema.safeParse(data).success).toBe(false);
});
it('checks exact actor and range after the read', async () => {
  const read = vi.fn().mockResolvedValue({ ok: true, data: f.funnelDashboard });
  expect(
    await getAnalyticsFunnelDashboard({ read }, f.funnelQuery, f.funnelActor),
  ).toEqual({ ok: true, data: f.funnelDashboard });
  expect(read).toHaveBeenCalledExactlyOnceWith(f.funnelQuery);
  expect(
    await getAnalyticsFunnelDashboard({ read }, f.funnelQuery, f.funnelOther),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(
    await getAnalyticsFunnelDashboard(
      { read },
      { from: '2026-10-02', to: f.funnelQuery.to },
      f.funnelActor,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it.each([null, {}, { ...f.funnelQuery, source: 'private' }])(
  'invalid service input skips database %#',
  async (query) => {
    const read = vi.fn();
    expect(
      await getAnalyticsFunnelDashboard({ read }, query, f.funnelActor),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(read).not.toHaveBeenCalled();
  },
);
it('invalid actor skips database', async () => {
  const read = vi.fn();
  expect(
    await getAnalyticsFunnelDashboard({ read }, f.funnelQuery, 'bad'),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(read).not.toHaveBeenCalled();
});
it('maps thrown details to unavailable and preserves safe port errors', async () => {
  const read = vi.fn().mockRejectedValue(new Error('private SQL'));
  expect(
    await getAnalyticsFunnelDashboard({ read }, f.funnelQuery, f.funnelActor),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  read.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
  expect(
    await getAnalyticsFunnelDashboard({ read }, f.funnelQuery, f.funnelActor),
  ).toEqual({ ok: false, code: 'FORBIDDEN' });
});
it('does not accept declared configured business metrics through a port', async () => {
  const read = vi.fn().mockResolvedValue({
    ok: true,
    data: {
      ...f.funnelDashboard,
      business_metrics: {
        ...f.funnelDashboard.business_metrics,
        configured: true,
      },
    },
  });
  expect(
    await getAnalyticsFunnelDashboard({ read }, f.funnelQuery, f.funnelActor),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('transport constraints remain technical and bounded', () => {
  expect(ANALYTICS_FUNNEL.responseMaxBytes).toBe(1024 * 1024);
  expect(
    analyticsFunnelQuerySchema.safeParse({
      from: '2026-01-01',
      to: '2027-01-01',
    }).success,
  ).toBe(true);
});
