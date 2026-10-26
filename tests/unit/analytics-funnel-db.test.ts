// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createAnalyticsFunnelPort } from '@/server/db/analytics-funnel';
import type { ActorClient } from '@/server/db/client';
import * as f from './analytics-funnel-fixtures';
function fixture(data: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    rpc,
    port: createAnalyticsFunnelPort({ rpc } as unknown as ActorClient),
  };
}
it('calls the current-actor aggregate RPC with dates only', async () => {
  const p = fixture(f.funnelDashboard);
  expect(await p.port.read(f.funnelQuery)).toEqual({
    ok: true,
    data: f.funnelDashboard,
  });
  expect(p.rpc).toHaveBeenCalledExactlyOnceWith('admin_analytics_dashboard', {
    p_from: f.funnelQuery.from,
    p_to: f.funnelQuery.to,
  });
});
it.each([
  null,
  {},
  { ...f.funnelDashboard, properties: { text: 'private' } },
  { ...f.funnelDashboard, daily: [] },
])('rejects invalid or private database JSON %#', async (data) =>
  expect(await fixture(data).port.read(f.funnelQuery)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  }),
);
it.each([
  ['ANALYTICS_DASHBOARD_FORBIDDEN', 'FORBIDDEN'],
  ['ANALYTICS_DASHBOARD_INVALID_INPUT', 'INVALID_INPUT'],
  ['ANALYTICS_DASHBOARD_ISOLATION_UNSUPPORTED', 'UNAVAILABLE'],
  ['ANALYTICS_DASHBOARD_COUNT_OUT_OF_RANGE', 'UNAVAILABLE'],
  ['__proto__', 'UNAVAILABLE'],
  ['private SQL', 'UNAVAILABLE'],
])('maps exact safe error %s', async (message, code) =>
  expect(
    await fixture(null, { message: message! }).port.read(f.funnelQuery),
  ).toEqual({ ok: false, code }),
);
it.each(['unconfigured', 'disabled'] as const)(
  'keeps truthful %s metadata',
  async (status) => {
    const data = f.unavailableFunnel(status);
    expect(await fixture(data).port.read(f.funnelQuery)).toEqual({
      ok: true,
      data,
    });
  },
);
