'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AdminSettingsError,
  AdminSettingsResult,
} from '@/config/admin-settings';

// Mounted private screens keep no server snapshot in reusable RSC payloads.
// Every restore rechecks the current actor; leaving clears data and late replies.
export function useAdminSettingsResource<T>(
  path: string,
  load: (signal: AbortSignal) => Promise<AdminSettingsResult<T>>,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<AdminSettingsError | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const alive = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const matches = useCallback(() => {
    const expected = new URL(path, window.location.origin);
    const current = new URL(window.location.href);
    return (
      expected.pathname === window.location.pathname &&
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
    setSaved(false);
    setEpoch((current) => current + 1);
  }, [stop]);
  const refresh = useCallback(async () => {
    if (!alive.current || !matches() || document.visibilityState === 'hidden')
      return false;
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
      return result.ok;
    } catch {
      if (alive.current && owner === generation.current)
        setError('UNAVAILABLE');
    } finally {
      if (owner === generation.current) {
        controller.current = null;
        if (alive.current) setBusy(false);
      }
    }
  }, [clear, load, matches]);
  const mutate = useCallback(
    async (
      action: (signal: AbortSignal) => Promise<AdminSettingsResult<unknown>>,
    ) => {
      if (!data || busy || controller.current || !alive.current || !matches())
        return false;
      clear();
      const owner = generation.current;
      const request = new AbortController();
      controller.current = request;
      setBusy(true);
      try {
        const result = await action(request.signal);
        if (
          !alive.current ||
          owner !== generation.current ||
          request.signal.aborted ||
          !matches()
        )
          return false;
        if (!result.ok) {
          setError(result.code);
          return false;
        }
        // Read-only refresh resolves uncertain ownership/version without replaying
        // the write. Fresh forms are mounted only after this read succeeds.
        const refreshed = await refresh();
        if (refreshed && alive.current && matches()) {
          setSaved(true);
          return true;
        }
        return false;
      } catch {
        if (alive.current && owner === generation.current)
          setError('UNAVAILABLE');
        return false;
      } finally {
        if (owner === generation.current) {
          controller.current = null;
          if (alive.current) setBusy(false);
        }
      }
    },
    [busy, clear, data, matches, refresh],
  );
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
  return {
    data,
    epoch,
    error,
    busy,
    saved,
    refresh,
    mutate,
    clear,
    dismissSaved: () => setSaved(false),
  };
}
