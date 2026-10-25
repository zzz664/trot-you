'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AdminSubscriptionError,
  AdminSubscriptionResult,
} from '@/config/admin-subscriptions';

// No private snapshot in reusable RSC payloads. Navigation, hiding and BFCache
// restoration invalidate the visible result and all outstanding response owners.
export function useAdminSubscriptionResource<T>(
  path: string,
  load: (signal: AbortSignal) => Promise<AdminSubscriptionResult<T>>,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<AdminSubscriptionError | null>(null);
  const [busy, setBusy] = useState(true);
  const alive = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const matches = useCallback(() => {
    const expected = new URL(path, window.location.origin);
    const current = new URL(window.location.href);
    expected.searchParams.sort();
    current.searchParams.sort();
    return (
      expected.pathname === current.pathname &&
      expected.search === current.search
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
  const refresh = useCallback(async () => {
    if (!alive.current || !matches() || document.visibilityState === 'hidden')
      return;
    clear();
    const owner = generation.current;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    try {
      const result = await load(request.signal);
      if (
        !alive.current ||
        owner !== generation.current ||
        request.signal.aborted ||
        !matches()
      )
        return;
      if (result.ok) setData(result.data);
      else setError(result.code);
    } catch {
      if (
        alive.current &&
        owner === generation.current &&
        !request.signal.aborted &&
        matches()
      )
        setError('UNAVAILABLE');
    } finally {
      if (owner === generation.current) {
        controller.current = null;
        if (alive.current) setBusy(false);
      }
    }
  }, [clear, load, matches]);
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
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive.current = false;
      stop();
      window.removeEventListener('popstate', navigate);
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('pageshow', restore);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [clear, matches, refresh, stop]);
  return { data, error, busy, refresh, clear };
}
