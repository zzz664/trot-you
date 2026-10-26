'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchActivitySnapshot } from '@/client/activity-rewards';
import type { ActivitySnapshot } from '@/config/activity-rewards';
import type { PointCursor, PointsError } from '@/config/attendance-points';
import { routes } from '@/config/routes';
import { scheduleRouteMatches } from '@/lib/schedule-navigation';

// Read-only, actor-bound snapshots. Even pagination hides the previously read
// data until the server has rechecked current authority for the next request.
export function useActivityRewards(actorKey: string) {
  const [data, setData] = useState<ActivitySnapshot | null>(null);
  const [error, setError] = useState<PointsError | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(false);
  const snapshot = useRef<ActivitySnapshot | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const matches = useCallback(
    () => scheduleRouteMatches(routes.activityRewards, window.location.href),
    [],
  );
  const visible = () => document.visibilityState !== 'hidden';
  const clear = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    snapshot.current = null;
    setData(null);
    setError(null);
    setBusy(false);
  }, []);
  const load = useCallback(
    async (cursor: PointCursor | null = null) => {
      if (!alive.current || !matches() || !visible()) return;
      const previous = cursor ? snapshot.current : null;
      clear();
      const owner = generation.current;
      const request = new AbortController();
      controller.current = request;
      setBusy(true);
      try {
        const result = await fetchActivitySnapshot(
          cursor,
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
        if (!result.ok) {
          setError(result.code);
          return;
        }
        if (result.data.actor_id !== actorKey) {
          setError('FORBIDDEN');
          return;
        }
        const next = previous
          ? {
              ...result.data,
              entries: [
                ...previous.entries,
                ...result.data.entries.filter(
                  (entry) =>
                    !previous.entries.some((old) => old.id === entry.id),
                ),
              ],
            }
          : result.data;
        snapshot.current = next;
        setData(next);
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
    },
    [actorKey, clear, matches],
  );
  const refresh = useCallback(() => load(), [load]);
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
      snapshot.current = null;
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('popstate', restore);
      window.removeEventListener('pageshow', pageshow);
      window.removeEventListener('focus', restore);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [clear, matches, refresh]);
  async function more() {
    if (controller.current || !snapshot.current?.next_cursor) return;
    await load(snapshot.current.next_cursor);
  }
  return { data, error, busy, refresh, more, clear };
}
