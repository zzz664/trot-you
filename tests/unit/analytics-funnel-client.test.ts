// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { fetchAnalyticsFunnelDashboard } from '@/client/analytics-funnel';
import {
  ANALYTICS_FUNNEL,
  ANALYTICS_FUNNEL_ERROR_STATUS,
  ANALYTICS_FUNNEL_EVENTS,
} from '@/config/analytics-funnel';
import { analyticsFunnelPath } from '@/config/routes';
import * as f from './analytics-funnel-fixtures';
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const ok = (data: unknown) => ({ ok: true, data });
const read = () =>
  fetchAnalyticsFunnelDashboard(f.funnelQuery, undefined, f.funnelActor);
afterEach(() => vi.unstubAllGlobals());
it('uses exact private expected-actor query and no body/cache/redirect', async () => {
  const fetcher = vi.fn().mockResolvedValue(response(ok(f.funnelDashboard)));
  vi.stubGlobal('fetch', fetcher);
  expect(await read()).toEqual(ok(f.funnelDashboard));
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    analyticsFunnelPath(f.funnelQuery, true),
    expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { [ANALYTICS_FUNNEL.actorHeader]: f.funnelActor },
    }),
  );
  expect(fetcher.mock.calls[0]![1]).not.toHaveProperty('body');
});
it.each(Object.entries(ANALYTICS_FUNNEL_ERROR_STATUS))(
  'preserves safe %s/status pair',
  async (code, status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ ok: false, code }, status)),
    );
    expect(await read()).toEqual({ ok: false, code });
  },
);
it.each([
  () => response(ok(f.funnelDashboard), 201),
  () => response({ ok: false, code: 'FORBIDDEN' }, 200),
  () => response({ ok: false, code: '__proto__' }, 503),
  () => response({ ok: false, code: 'SQL detail' }, 500),
  () => response({ ...ok(f.funnelDashboard), secret: true }),
  () => response(ok({ ...f.funnelDashboard, actor_id: f.funnelOther })),
  () => response(ok({ ...f.funnelDashboard, to: '2026-10-24' })),
  () => response(ok({ ...f.funnelDashboard, user_id: f.funnelOther })),
  () => response(ok({ ...f.funnelDashboard, events: [] })),
  () => response(ok({})),
  () =>
    new Response('<html>login</html>', {
      headers: { 'content-type': 'text/html' },
    }),
  () => new Response('{', { headers: { 'content-type': 'application/json' } }),
  () =>
    new Response(new Uint8Array([0xff]), {
      headers: { 'content-type': 'application/json' },
    }),
  () => new Response(null, { headers: { 'content-type': 'application/json' } }),
  () =>
    new Response(' '.repeat(ANALYTICS_FUNNEL.responseMaxBytes + 1), {
      headers: { 'content-type': 'application/json' },
    }),
])('rejects malformed, stale or unsafe transport %#', async (make) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(make()));
  expect(await read()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it.each([undefined, '', 'bad'])(
  'invalid actor %s prevents I/O',
  async (actor) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(
      await fetchAnalyticsFunnelDashboard(f.funnelQuery, undefined, actor),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(fetcher).not.toHaveBeenCalled();
  },
);
it('invalid range prevents I/O', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect(
    await fetchAnalyticsFunnelDashboard(
      { from: 'bad', to: f.funnelQuery.to },
      undefined,
      f.funnelActor,
    ),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('aborted read never starts', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const c = new AbortController();
  c.abort();
  expect(
    await fetchAnalyticsFunnelDashboard(f.funnelQuery, c.signal, f.funnelActor),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('late response after abort is not successful', async () => {
  const c = new AbortController();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => {
      c.abort();
      return response(ok(f.funnelDashboard));
    }),
  );
  expect(
    await fetchAnalyticsFunnelDashboard(f.funnelQuery, c.signal, f.funnelActor),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('normalizes valid uppercase expected actor', async () => {
  const actor = 'ABCDEF12-0000-4000-8000-000000000001';
  const data = { ...f.funnelDashboard, actor_id: actor.toLowerCase() };
  const fetcher = vi.fn().mockResolvedValue(response(ok(data)));
  vi.stubGlobal('fetch', fetcher);
  expect(
    await fetchAnalyticsFunnelDashboard(f.funnelQuery, undefined, actor),
  ).toEqual(ok(data));
  expect(fetcher.mock.calls[0]![1].headers).toEqual({
    [ANALYTICS_FUNNEL.actorHeader]: actor.toLowerCase(),
  });
});
it('network or body failures cannot leak diagnostics', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('SQL/session')));
  expect(await read()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('allows valid complete leap-year 366×13 data above the old 256KiB cap', async () => {
  const query = { from: '2024-01-01', to: '2024-12-31' };
  const daily = Array.from({ length: 366 }, (_, index) =>
    new Date(Date.parse(query.from) + index * 86400000)
      .toISOString()
      .slice(0, 10),
  ).flatMap((day_kst) =>
    ANALYTICS_FUNNEL_EVENTS.map((name) => ({ day_kst, name, event_count: 1 })),
  );
  const data = {
    ...f.funnelDashboard,
    ...query,
    window_start: '2023-12-31T15:00:00Z',
    window_end: '2024-12-31T15:00:00Z',
    daily,
    events: ANALYTICS_FUNNEL_EVENTS.map((name) => ({ name, event_count: 366 })),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(ok(data))).length;
  expect(bytes).toBeGreaterThan(256 * 1024);
  expect(bytes).toBeLessThan(ANALYTICS_FUNNEL.responseMaxBytes);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(ok(data))));
  expect(
    await fetchAnalyticsFunnelDashboard(query, undefined, f.funnelActor),
  ).toEqual(ok(data));
});
it.each(['unconfigured', 'disabled'] as const)(
  'preserves %s instead of synthetic zero',
  async (status) => {
    const data = f.unavailableFunnel(status);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(ok(data))));
    expect(await read()).toEqual(ok(data));
  },
);
