'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAnalyticsFunnelDashboard } from '@/client/analytics-funnel';
import type {
  AnalyticsFunnelDashboard,
  AnalyticsFunnelError,
  AnalyticsFunnelQuery,
} from '@/config/analytics-funnel';
import { scheduleRouteMatches } from '@/lib/schedule-navigation';
export function useAnalyticsFunnel(
  actorKey: string,
  query: AnalyticsFunnelQuery,
  path: string,
) {
  const [data, setData] = useState<AnalyticsFunnelDashboard | null>(null);
  const [error, setError] = useState<AnalyticsFunnelError | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const matches = useCallback(
    () => scheduleRouteMatches(path, window.location.href),
    [path],
  );
  const visible = () => document.visibilityState !== 'hidden';
  const clear = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    setData(null);
    setError(null);
    setBusy(false);
  }, []);
  const refresh = useCallback(async () => {
    if (!alive.current || !matches() || !visible()) return;
    clear();
    const owner = generation.current;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    try {
      const result = await fetchAnalyticsFunnelDashboard(
        query,
        request.signal,
        actorKey,
      );
      if (
        !alive.current ||
        owner !== generation.current ||
        request.signal.aborted ||
        !matches() ||
        !visible()
      )
        return;
      if (!result.ok) setError(result.code);
      else if (
        result.data.actor_id !== actorKey ||
        result.data.from !== query.from ||
        result.data.to !== query.to
      )
        setError('FORBIDDEN');
      else setData(result.data);
    } catch {
      if (
        alive.current &&
        owner === generation.current &&
        !request.signal.aborted &&
        matches() &&
        visible()
      )
        setError('UNAVAILABLE');
    } finally {
      if (alive.current && owner === generation.current) {
        controller.current = null;
        setBusy(false);
      }
    }
  }, [actorKey, clear, matches, query]);
  useEffect(() => {
    alive.current = true;
    const owner = generation.current;
    queueMicrotask(() => {
      if (alive.current && owner === generation.current) void refresh();
    });
    const restore = () => {
      clear();
      if (matches()) void refresh();
    };
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) restore();
    };
    const visibility = () => {
      if (visible()) restore();
      else clear();
    };
    window.addEventListener('pagehide', clear);
    window.addEventListener('popstate', restore);
    window.addEventListener('pageshow', pageshow);
    window.addEventListener('focus', restore);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive.current = false;
      generation.current += 1;
      controller.current?.abort();
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('popstate', restore);
      window.removeEventListener('pageshow', pageshow);
      window.removeEventListener('focus', restore);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [clear, matches, refresh]);
  return { data, error, busy, refresh, clear };
}
