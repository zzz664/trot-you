'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchBillingNotices,
  markBillingNoticeRead,
  setBillingNoticePreference,
} from '@/client/billing-notices';
import type {
  BillingNoticeError,
  BillingNoticeList,
  BillingNoticeResult,
} from '@/config/billing-notices';
import { routes } from '@/config/routes';

export function useBillingNotices(cursor: string | null) {
  const [page, setPage] = useState<BillingNoticeList | null>(null);
  const [error, setError] = useState<BillingNoticeError | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mutation = useRef(false);
  const matchesLocation = useCallback(() => {
    const query = new URLSearchParams(window.location.search);
    return (
      window.location.pathname === routes.billingNotices &&
      query.getAll('cursor').length <= 1 &&
      query.get('cursor') === cursor
    );
  }, [cursor]);
  const stop = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    mutation.current = false;
  }, []);
  const clear = useCallback(() => {
    stop();
    setPage(null);
    setError(null);
    setBusy(false);
  }, [stop]);
  const refresh = useCallback(async () => {
    if (
      !alive.current ||
      !matchesLocation() ||
      document.visibilityState === 'hidden'
    )
      return;
    clear();
    const owner = generation.current;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    try {
      const result = await fetchBillingNotices(
        cursor ?? undefined,
        request.signal,
      );
      if (
        !alive.current ||
        owner !== generation.current ||
        request.signal.aborted ||
        !matchesLocation()
      )
        return;
      if (result.ok) setPage(result.data);
      else setError(result.code);
    } catch {
      if (alive.current && owner === generation.current)
        setError('UNAVAILABLE');
    } finally {
      if (owner === generation.current) {
        controller.current = null;
        if (alive.current) setBusy(false);
      }
    }
  }, [clear, cursor, matchesLocation]);
  const mutate = useCallback(
    async (
      action: (signal: AbortSignal) => Promise<BillingNoticeResult<unknown>>,
    ) => {
      if (
        !page ||
        busy ||
        mutation.current ||
        controller.current ||
        !matchesLocation()
      )
        return;
      // Clear before mutation: a canceled/rescheduled notice must not remain on
      // screen while its current owner/eligibility is being checked again.
      clear();
      mutation.current = true;
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
          !matchesLocation()
        )
          return;
        if (!result.ok) setError(result.code);
        else await refresh();
      } catch {
        if (alive.current && owner === generation.current)
          setError('UNAVAILABLE');
      } finally {
        if (owner === generation.current) {
          mutation.current = false;
          controller.current = null;
          if (alive.current) setBusy(false);
        }
      }
    },
    [busy, clear, matchesLocation, page, refresh],
  );
  const markRead = useCallback(
    (noticeId: string) => {
      if (
        !page?.notices.some(
          (notice) => notice.id === noticeId && notice.readAt === null,
        )
      )
        return Promise.resolve();
      return mutate((signal) => markBillingNoticeRead(noticeId, signal));
    },
    [mutate, page],
  );
  const setPreference = useCallback(
    (enabled: boolean) => {
      if (!page || page.billingEnabled === enabled) return Promise.resolve();
      return mutate((signal) => setBillingNoticePreference(enabled, signal));
    },
    [mutate, page],
  );
  useEffect(() => {
    alive.current = true;
    const owner = generation.current;
    queueMicrotask(() => {
      if (alive.current && owner === generation.current) void refresh();
    });
    const navigate = () => {
      clear();
      if (matchesLocation()) void refresh();
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
  }, [clear, matchesLocation, refresh, stop]);
  return { page, error, busy, refresh, markRead, setPreference, clear };
}
