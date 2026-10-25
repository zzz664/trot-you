'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readArtistReplyActivityMessages,
  readArtistReplyActivityPage,
} from '@/client/artist-reply-activity';
import type {
  ArtistReplyActivityError,
  ArtistReplyActivityMessages,
  ArtistReplyActivityPage,
} from '@/config/artist-reply-activity';
import { artistReplyActivityPath } from '@/config/routes';

export function useArtistReplyActivity({
  slug,
  messageId,
  cursor,
}: {
  slug: string;
  messageId: string | null;
  cursor: string | null;
}) {
  const [page, setPage] = useState<ArtistReplyActivityPage | null>(null);
  const [messages, setMessages] = useState<ArtistReplyActivityMessages | null>(
    null,
  );
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [error, setError] = useState<ArtistReplyActivityError | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const pathname = artistReplyActivityPath(slug);
  const matchesLocation = useCallback(() => {
    const query = new URLSearchParams(window.location.search);
    return (
      window.location.pathname === pathname &&
      query.getAll('message').length <= 1 &&
      query.getAll('cursor').length <= 1 &&
      query.get('message') === messageId &&
      query.get('cursor') === cursor
    );
  }, [cursor, messageId, pathname]);
  const stop = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
  }, []);
  const clear = useCallback(() => {
    stop();
    setPage(null);
    setMessages(null);
    setMessageCursor(null);
    setError(null);
    setBusy(false);
  }, [stop]);
  const fail = useCallback((code: ArtistReplyActivityError) => {
    // Never leave a previously authorized fan reply visible after failed
    // revalidation, even when the failure is a temporary transport error.
    setPage(null);
    setMessages(null);
    setMessageCursor(null);
    setError(code);
  }, []);
  const load = useCallback(
    async (nextMessageCursor: string | null) => {
      if (!alive.current || !matchesLocation()) return;
      clear();
      const owner = generation.current;
      const request = new AbortController();
      controller.current = request;
      setBusy(true);
      try {
        const [context, picker] = await Promise.all([
          readArtistReplyActivityPage(
            { slug, messageId, ...(cursor ? { cursor } : {}) },
            request.signal,
          ),
          readArtistReplyActivityMessages(
            {
              slug,
              ...(nextMessageCursor ? { cursor: nextMessageCursor } : {}),
            },
            request.signal,
          ),
        ]);
        if (
          !alive.current ||
          owner !== generation.current ||
          request.signal.aborted ||
          !matchesLocation()
        )
          return;
        if (!context.ok || !picker.ok) {
          const failure = !context.ok ? context : !picker.ok ? picker : null;
          if (failure) fail(failure.code);
          return;
        }
        setPage(context.data);
        setMessages(picker.data);
        setMessageCursor(nextMessageCursor);
      } catch {
        if (alive.current && owner === generation.current) fail('UNAVAILABLE');
      } finally {
        if (owner === generation.current) {
          controller.current = null;
          if (alive.current) setBusy(false);
        }
      }
    },
    [clear, cursor, fail, matchesLocation, messageId, slug],
  );
  const refresh = useCallback(() => load(null), [load]);
  const readMessages = useCallback(
    async (next: string | null) => {
      if (!page || busy || controller.current) return;
      await load(next);
    },
    [busy, load, page],
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
    window.addEventListener('popstate', navigate);
    window.addEventListener('pagehide', clear);
    window.addEventListener('pageshow', restore);
    return () => {
      alive.current = false;
      stop();
      window.removeEventListener('popstate', navigate);
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('pageshow', restore);
    };
  }, [clear, matchesLocation, refresh, stop]);
  return {
    page,
    messages,
    messageCursor,
    error,
    busy,
    refresh,
    readMessages,
    clear,
  };
}
