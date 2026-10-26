'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommunityError, CommunityResult } from '@/config/community-posts';
import { scheduleRouteMatches } from '@/lib/schedule-navigation';

// Pending requests are immutable and kept only in the current actor/target
// component. Losing a readable snapshot does not prove a mutation failed.
export function useModerationOperation<I, O>({
  path,
  send,
  onSuccess,
  authorityError,
}: {
  path: string;
  send: (input: I, signal: AbortSignal) => Promise<CommunityResult<O>>;
  onSuccess?: (data: O) => void | Promise<void>;
  authorityError?: CommunityError | null;
}) {
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<CommunityError | null>(null);
  const [saved, setSaved] = useState(false);
  const intent = useRef<I | null>(null);
  const running = useRef(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const clear = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    intent.current = null;
    setBusy(false);
    setUncertain(false);
    setError(null);
    setSaved(false);
  }, []);
  useEffect(() => {
    alive.current = true;
    const interrupt = () => {
      generation.current += 1;
      controller.current?.abort();
      controller.current = null;
      setBusy(false);
      setSaved(false);
      if (intent.current) setUncertain(true);
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') interrupt();
    };
    window.addEventListener('pagehide', interrupt);
    window.addEventListener('popstate', interrupt);
    window.addEventListener('focus', interrupt);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive.current = false;
      generation.current += 1;
      controller.current?.abort();
      window.removeEventListener('pagehide', interrupt);
      window.removeEventListener('popstate', interrupt);
      window.removeEventListener('focus', interrupt);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => {
    if (
      authorityError === 'FORBIDDEN' ||
      authorityError === 'UNAUTHENTICATED'
    ) {
      queueMicrotask(() => {
        if (!alive.current) return;
        clear();
        setError(authorityError);
      });
    }
  }, [authorityError, clear]);
  async function run(input?: I) {
    if (
      !alive.current ||
      running.current ||
      authorityError === 'FORBIDDEN' ||
      authorityError === 'UNAUTHENTICATED' ||
      !scheduleRouteMatches(path, window.location.href) ||
      document.visibilityState === 'hidden'
    )
      return;
    const operation = intent.current ?? input;
    if (!operation) return;
    intent.current = operation;
    running.current = true;
    const owner = generation.current;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setUncertain(false);
    setError(null);
    setSaved(false);
    try {
      const result = await send(operation, request.signal);
      if (
        !alive.current ||
        generation.current !== owner ||
        request.signal.aborted ||
        !scheduleRouteMatches(path, window.location.href)
      )
        return;
      if (!result.ok && result.code === 'UNAVAILABLE') {
        setUncertain(true);
        return;
      }
      intent.current = null;
      if (result.ok) {
        setSaved(true);
        await onSuccess?.(result.data);
      } else setError(result.code);
    } catch {
      if (alive.current && generation.current === owner) {
        // A read/refresh failure after an acknowledged receipt is not an
        // unknown mutation outcome and must never offer a new replay.
        if (intent.current === operation) setUncertain(true);
        else setError('UNAVAILABLE');
      }
    } finally {
      running.current = false;
      if (alive.current && generation.current === owner) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  return { busy, uncertain, error, saved, run, clear };
}
