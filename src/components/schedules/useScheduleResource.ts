'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScheduleError, ScheduleResult } from '@/config/schedules';

// Actor-specific membership/admin snapshots are never kept in route payloads.
// Navigation, restored tabs and authority failures invalidate in-flight results.
export function useScheduleResource<T>(
  path: string,
  load: (signal: AbortSignal) => Promise<ScheduleResult<T>>,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ScheduleError | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const matches = useCallback(() => {
    const expected = new URL(path, window.location.origin);
    return (
      expected.pathname === window.location.pathname &&
      expected.search === window.location.search
    );
  }, [path]);
  const stop = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
  }, []);
  const clear = useCallback(() => {
    stop();
    setData(null);
    setError(null);
    setBusy(false);
  }, [stop]);
  const execute = useCallback(
    async <R>(
      action: (signal: AbortSignal) => Promise<ScheduleResult<R>>,
    ): Promise<ScheduleResult<R> | null> => {
      if (
        !alive.current ||
        controller.current ||
        !matches() ||
        document.visibilityState === 'hidden'
      )
        return null;
      const owner = generation.current;
      const request = new AbortController();
      controller.current = request;
      setBusy(true);
      setError(null);
      try {
        const result = await action(request.signal);
        if (
          !alive.current ||
          owner !== generation.current ||
          request.signal.aborted ||
          !matches()
        )
          return null;
        if (!result.ok) {
          setError(result.code);
          if (result.code === 'UNAUTHENTICATED' || result.code === 'FORBIDDEN')
            setData(null);
        }
        return result;
      } catch {
        if (
          !alive.current ||
          owner !== generation.current ||
          request.signal.aborted ||
          !matches()
        )
          return null;
        setError('UNAVAILABLE');
        return { ok: false, code: 'UNAVAILABLE' };
      } finally {
        if (owner === generation.current) {
          controller.current = null;
          if (alive.current) setBusy(false);
        }
      }
    },
    [matches],
  );
  const refresh = useCallback(async () => {
    if (!alive.current || !matches() || document.visibilityState === 'hidden')
      return;
    clear();
    const result = await execute(load);
    if (result?.ok) setData(result.data);
  }, [clear, execute, load, matches]);
  useEffect(() => {
    alive.current = true;
    const owner = generation.current;
    queueMicrotask(() => {
      if (alive.current && owner === generation.current) void refresh();
    });
    const navigate = () => {
      clear();
      if (matches()) void refresh();
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) navigate();
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') clear();
      else navigate();
    };
    window.addEventListener('popstate', navigate);
    window.addEventListener('pagehide', clear);
    window.addEventListener('pageshow', restore);
    window.addEventListener('focus', navigate);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive.current = false;
      stop();
      window.removeEventListener('popstate', navigate);
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('pageshow', restore);
      window.removeEventListener('focus', navigate);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [clear, matches, refresh, stop]);
  return { data, error, busy, refresh, execute, clear, setData };
}
