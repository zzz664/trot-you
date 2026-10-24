'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  cancelDispatch,
  readDispatchPage,
  submitDispatch,
} from '@/client/dispatch';
import type {
  DispatchCancelInput,
  DispatchError,
  DispatchMessage,
  DispatchPageData,
  DispatchSubmitInput,
} from '@/config/message-dispatch';

type Operation =
  | { kind: 'submit'; input: DispatchSubmitInput }
  | { kind: 'cancel'; input: DispatchCancelInput };
function losesAccess(code: DispatchError) {
  return code === 'FORBIDDEN' || code === 'UNAUTHENTICATED';
}
export function useArtistDispatch({
  slug,
  pathname,
  initialDispatchedId,
  onPublished,
  onAccessLost,
}: {
  slug: string;
  pathname: string;
  initialDispatchedId?: string;
  onPublished: () => Promise<boolean>;
  onAccessLost: () => void;
}) {
  const [page, setPage] = useState<DispatchPageData | null>(null);
  const [receipt, setReceipt] = useState<DispatchMessage | null>(null);
  const [error, setError] = useState<DispatchError | null>(null);
  const [busy, setBusy] = useState<'page' | 'submit' | 'cancel' | null>('page');
  const [uncertain, setUncertain] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [accessLost, setAccessLost] = useState(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const running = useRef(false);
  const operation = useRef<Operation | null>(null);
  const current = useRef<DispatchPageData | null>(null);
  const accepted = useRef<DispatchMessage | null>(null);
  const callbacks = useRef({ onPublished, onAccessLost });
  useLayoutEffect(() => {
    callbacks.current = { onPublished, onAccessLost };
  }, [onPublished, onAccessLost]);
  const controllers = useRef(new Set<AbortController>());
  const stop = useCallback(() => {
    generation.current += 1;
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    running.current = false;
  }, []);
  const clear = useCallback(
    (lost = false) => {
      stop();
      operation.current = null;
      current.current = null;
      accepted.current = null;
      setPage(null);
      setReceipt(null);
      setError(null);
      setBusy(null);
      setUncertain(false);
      setRefreshRequired(false);
      setAccessLost(lost);
      if (lost) callbacks.current.onAccessLost();
    },
    [stop],
  );
  const fail = useCallback(
    (code: DispatchError) => {
      if (losesAccess(code)) clear(true);
      else setError(code);
    },
    [clear],
  );
  const put = useCallback((item: DispatchMessage) => {
    accepted.current = item;
    setReceipt(item);
    if (current.current) {
      const next = {
        ...current.current,
        selectedMessage: item,
        messages: current.current.messages.some((row) => row.id === item.id)
          ? current.current.messages.map((row) =>
              row.id === item.id ? item : row,
            )
          : [item, ...current.current.messages],
      };
      current.current = next;
      setPage(next);
    }
  }, []);
  const finishSubmit = useCallback(async (owner: number) => {
    // A successful dispatch must not leave the now-immutable message editable.
    // Failed composer refresh keeps this panel frozen instead of authorizing a
    // second write from its stale draft snapshot.
    let fresh = false;
    try {
      fresh = await callbacks.current.onPublished();
    } catch {
      /* Keep stale editor frozen. */
    }
    if (!alive.current || owner !== generation.current) return false;
    setRefreshRequired(!fresh);
    return fresh;
  }, []);
  const load = useCallback(
    async (older = false, selectedId?: string | null) => {
      if (
        !alive.current ||
        running.current ||
        window.location.pathname !== pathname
      )
        return false;
      const cursor = older ? current.current?.nextCursor : null;
      if (older && !cursor) return false;
      running.current = true;
      setBusy('page');
      setError(null);
      const owner = generation.current;
      const controller = new AbortController();
      controllers.current.add(controller);
      const pending = operation.current;
      const messageId =
        selectedId === undefined
          ? (pending?.input.messageId ??
            accepted.current?.id ??
            initialDispatchedId ??
            null)
          : selectedId;
      try {
        const result = await readDispatchPage(
          { slug, messageId, ...(cursor ? { cursor } : {}) },
          controller.signal,
        );
        if (
          !alive.current ||
          owner !== generation.current ||
          controller.signal.aborted
        )
          return false;
        if (!result.ok) {
          fail(result.code);
          return false;
        }
        const next =
          older && current.current
            ? {
                ...result.data,
                messages: [
                  ...current.current.messages,
                  ...result.data.messages.filter(
                    (row) =>
                      !current.current?.messages.some(
                        (existing) => existing.id === row.id,
                      ),
                  ),
                ],
              }
            : result.data;
        current.current = next;
        setPage(next);
        setAccessLost(false);
        const selected = result.data.selectedMessage;
        if (selected) {
          accepted.current = selected;
          setReceipt(selected);
        }
        if (
          pending &&
          selected &&
          (pending.kind === 'submit' || selected.status === 'canceled')
        ) {
          operation.current = null;
          setUncertain(false);
          if (pending.kind === 'submit') await finishSubmit(owner);
        }
        return true;
      } catch {
        if (alive.current && owner === generation.current)
          setError('UNAVAILABLE');
        return false;
      } finally {
        controllers.current.delete(controller);
        if (owner === generation.current) {
          running.current = false;
          if (alive.current) setBusy(null);
        }
      }
    },
    [fail, finishSubmit, initialDispatchedId, pathname, slug],
  );
  const mutate = useCallback(
    async (candidate?: Operation) => {
      if (
        !alive.current ||
        running.current ||
        window.location.pathname !== pathname
      )
        return;
      if (!operation.current && candidate) operation.current = candidate;
      const pending = operation.current;
      if (!pending) return;
      running.current = true;
      setBusy(pending.kind);
      setError(null);
      setReceipt(null);
      const owner = generation.current;
      const controller = new AbortController();
      controllers.current.add(controller);
      try {
        const result =
          pending.kind === 'submit'
            ? await submitDispatch(pending.input, controller.signal)
            : await cancelDispatch(pending.input, controller.signal);
        if (
          !alive.current ||
          owner !== generation.current ||
          controller.signal.aborted
        )
          return;
        if (!result.ok) {
          if (losesAccess(result.code)) {
            clear(true);
            return;
          }
          const unknown =
            result.code === 'UNAVAILABLE' ||
            result.code === 'IDEMPOTENCY_CONFLICT';
          if (!unknown) operation.current = null;
          setUncertain(unknown);
          setError(result.code);
          return;
        }
        operation.current = null;
        setUncertain(false);
        put(result.data);
        if (pending.kind === 'submit') await finishSubmit(owner);
      } catch {
        if (alive.current && owner === generation.current) {
          setUncertain(true);
          setError('UNAVAILABLE');
        }
      } finally {
        controllers.current.delete(controller);
        if (owner === generation.current) {
          running.current = false;
          if (alive.current) setBusy(null);
        }
      }
    },
    [clear, finishSubmit, pathname, put],
  );
  const refreshEditor = useCallback(async () => {
    if (!alive.current || running.current) return;
    running.current = true;
    setBusy('page');
    const owner = generation.current;
    try {
      await finishSubmit(owner);
    } finally {
      if (owner === generation.current) {
        running.current = false;
        if (alive.current) setBusy(null);
      }
    }
  }, [finishSubmit]);
  useEffect(() => {
    alive.current = true;
    const owner = generation.current;
    queueMicrotask(() => {
      if (alive.current && owner === generation.current) void load(false);
    });
    const navigate = () => {
      clear();
      if (window.location.pathname === pathname) void load(false, null);
    };
    const hide = () => clear();
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) navigate();
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (running.current || operation.current) event.preventDefault();
    };
    window.addEventListener('popstate', navigate);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', restore);
    window.addEventListener('beforeunload', unload);
    return () => {
      alive.current = false;
      stop();
      window.removeEventListener('popstate', navigate);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', restore);
      window.removeEventListener('beforeunload', unload);
    };
  }, [clear, load, pathname, stop]);
  return {
    page,
    receipt,
    error,
    busy,
    uncertain,
    refreshRequired,
    accessLost,
    load,
    refreshEditor,
    retry: () => mutate(),
    submit: (input: DispatchSubmitInput) => mutate({ kind: 'submit', input }),
    cancel: (input: DispatchCancelInput) => mutate({ kind: 'cancel', input }),
  };
}
