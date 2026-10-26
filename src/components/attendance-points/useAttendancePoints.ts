'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  checkAttendance,
  fetchPointSnapshot,
} from '@/client/attendance-points';
import type {
  AttendanceInput,
  AttendanceReceipt,
  PointCursor,
  PointSnapshot,
  PointsError,
} from '@/config/attendance-points';
import { routes } from '@/config/routes';
import { scheduleRouteMatches } from '@/lib/schedule-navigation';

// The actor-bound operation is deliberately independent from the readable page:
// an unavailable snapshot says nothing about whether a check-in committed.
export function useAttendancePoints(actorKey: string) {
  const [data, setData] = useState<PointSnapshot | null>(null);
  const [error, setError] = useState<PointsError | null>(null);
  const [busy, setBusy] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [receipt, setReceipt] = useState<AttendanceReceipt | null>(null);
  const [mutationError, setMutationError] = useState<PointsError | null>(null);
  const alive = useRef(false);
  const snapshot = useRef<PointSnapshot | null>(null);
  const pending = useRef<AttendanceInput | null>(null);
  const reader = useRef<AbortController | null>(null);
  const writer = useRef<AbortController | null>(null);
  const readGeneration = useRef(0);
  const writeGeneration = useRef(0);
  const denied = useRef(false);
  const matches = useCallback(
    () => scheduleRouteMatches(routes.points, window.location.href),
    [],
  );
  const visible = () => document.visibilityState !== 'hidden';
  const stopRead = useCallback(() => {
    readGeneration.current += 1;
    reader.current?.abort();
    reader.current = null;
    snapshot.current = null;
    setData(null);
    setBusy(false);
    setError(null);
  }, []);
  const stopWrite = useCallback((discard: boolean) => {
    writeGeneration.current += 1;
    writer.current?.abort();
    writer.current = null;
    if (discard) pending.current = null;
    setMutating(false);
    setUncertain(pending.current !== null);
    setReceipt(null);
    setMutationError(null);
  }, []);
  const clear = useCallback(() => {
    stopRead();
    stopWrite(true);
  }, [stopRead, stopWrite]);
  const invalidate = useCallback(
    (code: PointsError) => {
      denied.current = true;
      clear();
      setError(code);
    },
    [clear],
  );
  const load = useCallback(
    async (cursor: PointCursor | null = null) => {
      if (!alive.current || !matches() || !visible()) return;
      const previous = cursor ? snapshot.current : null;
      stopRead();
      if (previous) {
        snapshot.current = previous;
        setData(previous);
      }
      const generation = readGeneration.current;
      const request = new AbortController();
      reader.current = request;
      setBusy(true);
      try {
        const result = await fetchPointSnapshot(
          cursor,
          request.signal,
          actorKey,
        );
        if (
          !alive.current ||
          readGeneration.current !== generation ||
          request.signal.aborted ||
          !matches() ||
          !visible()
        )
          return;
        if (!result.ok) {
          if (
            result.code === 'UNAUTHENTICATED' ||
            result.code === 'FORBIDDEN'
          ) {
            invalidate(result.code);
          } else {
            snapshot.current = null;
            setData(null);
            setError(result.code);
          }
          return;
        }
        if (result.data.actor_id !== actorKey) {
          invalidate('FORBIDDEN');
          return;
        }
        denied.current = false;
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
          readGeneration.current === generation &&
          !request.signal.aborted &&
          matches()
        ) {
          snapshot.current = null;
          setData(null);
          setError('UNAVAILABLE');
        }
      } finally {
        if (alive.current && readGeneration.current === generation) {
          reader.current = null;
          setBusy(false);
        }
      }
    },
    [actorKey, invalidate, matches, stopRead],
  );
  const refresh = useCallback(() => load(), [load]);
  useEffect(() => {
    alive.current = true;
    const generation = readGeneration.current;
    queueMicrotask(() => {
      if (alive.current && generation === readGeneration.current)
        void refresh();
    });
    const interrupt = () => {
      stopRead();
      stopWrite(!matches());
    };
    const restore = () => {
      interrupt();
      if (matches()) void refresh();
    };
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) restore();
    };
    const visibility = () => {
      if (visible()) restore();
      else interrupt();
    };
    window.addEventListener('pagehide', interrupt);
    window.addEventListener('popstate', restore);
    window.addEventListener('pageshow', pageshow);
    window.addEventListener('focus', restore);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive.current = false;
      readGeneration.current += 1;
      writeGeneration.current += 1;
      reader.current?.abort();
      writer.current?.abort();
      pending.current = null;
      snapshot.current = null;
      window.removeEventListener('pagehide', interrupt);
      window.removeEventListener('popstate', restore);
      window.removeEventListener('pageshow', pageshow);
      window.removeEventListener('focus', restore);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [matches, refresh, stopRead, stopWrite]);
  async function attend(recover = false) {
    if (
      !alive.current ||
      writer.current ||
      denied.current ||
      !matches() ||
      !visible()
    )
      return;
    if (
      !recover &&
      (pending.current ||
        reader.current ||
        !snapshot.current ||
        snapshot.current.attendance_entry_id !== null ||
        snapshot.current.attendance_amount === null)
    )
      return;
    if (recover && !pending.current) return;
    const input = pending.current ?? { operation_id: crypto.randomUUID() };
    pending.current = input;
    const generation = writeGeneration.current;
    const request = new AbortController();
    writer.current = request;
    setMutating(true);
    setUncertain(false);
    setReceipt(null);
    setMutationError(null);
    try {
      const result = await checkAttendance(input, request.signal, actorKey);
      if (
        !alive.current ||
        writeGeneration.current !== generation ||
        request.signal.aborted ||
        !matches() ||
        !visible()
      )
        return;
      if (!result.ok) {
        if (result.code === 'UNAUTHENTICATED' || result.code === 'FORBIDDEN')
          invalidate(result.code);
        else if (result.code === 'UNAVAILABLE' || recover) {
          // A retry can fail before reaching the immutable receipt (for
          // example, temporary server configuration loss). That does not
          // establish whether the original request committed. Only a bound
          // receipt or definitive authority reset resolves this intent.
          setUncertain(true);
        } else {
          pending.current = null;
          setMutationError(result.code);
          // Re-read policy/balance rather than retain the pre-request authority.
          await refresh();
        }
        return;
      }
      if (
        result.data.actor_id !== actorKey ||
        result.data.operation_id !== input.operation_id
      ) {
        invalidate('FORBIDDEN');
        return;
      }
      pending.current = null;
      setReceipt(result.data);
      await refresh();
    } catch {
      if (alive.current && writeGeneration.current === generation) {
        if (pending.current) setUncertain(true);
        else setMutationError('UNAVAILABLE');
      }
    } finally {
      if (alive.current && writeGeneration.current === generation) {
        writer.current = null;
        setMutating(false);
      }
    }
  }
  return {
    data,
    error,
    busy,
    mutating,
    uncertain,
    receipt,
    mutationError,
    clear,
    refresh,
    attend: () => attend(),
    recover: () => attend(true),
    more: () => {
      if (!reader.current && !writer.current && snapshot.current?.next_cursor)
        return load(snapshot.current.next_cursor);
    },
  };
}
