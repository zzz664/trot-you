'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { markChatRead, readChatPage } from '@/client/chat';
import type { ChatError, ChatPage } from '@/config/chat';

function closesConversation(code: ChatError) {
  return (
    code === 'UNAUTHENTICATED' ||
    code === 'FORBIDDEN' ||
    code === 'SUBSCRIPTION_REQUIRED' ||
    code === 'PROFILE_REQUIRED' ||
    code === 'NOT_FOUND'
  );
}

export function useFanChat(initial: ChatPage) {
  const active = useRef(true);
  const generation = useRef(0);
  const current = useRef<ChatPage | null>(initial);
  const controllers = useRef(new Set<AbortController>());
  const reading = useRef(new Set<string>());
  const paging = useRef(false);
  const lastOperation = useRef(false);
  const [data, setData] = useState<ChatPage | null>(initial);
  const [pending, setPending] = useState<'older' | 'refresh' | null>(null);
  const [observationEpoch, setObservationEpoch] = useState(0);
  const [error, setError] = useState<ChatError | null>(null);
  const [readPending, setReadPending] = useState<Set<string>>(new Set());
  const [readErrors, setReadErrors] = useState<Set<string>>(new Set());

  const stop = useCallback(() => {
    generation.current += 1;
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    reading.current.clear();
    paging.current = false;
  }, []);
  const clear = useCallback(
    (code: ChatError = 'UNAVAILABLE') => {
      stop();
      current.current = null;
      setData(null);
      setError(code);
      setPending(null);
      setReadPending(new Set());
      setReadErrors(new Set());
    },
    [stop],
  );

  const markRead = useCallback(
    async (messageId: string) => {
      const page = current.current;
      if (
        !active.current ||
        !page ||
        reading.current.has(messageId) ||
        paging.current ||
        !page.messages.some(
          (message) => message.id === messageId && message.readAt === null,
        )
      )
        return;
      reading.current.add(messageId);
      setReadPending(new Set(reading.current));
      setReadErrors(
        (previous) => new Set([...previous].filter((id) => id !== messageId)),
      );
      const controller = new AbortController();
      controllers.current.add(controller);
      const version = generation.current;
      try {
        const result = await markChatRead(
          { slug: page.artist.slug, messageId },
          controller.signal,
        );
        if (
          !active.current ||
          generation.current !== version ||
          controller.signal.aborted
        )
          return;
        if (!result.ok) {
          if (closesConversation(result.code)) clear(result.code);
          else setReadErrors((previous) => new Set([...previous, messageId]));
          return;
        }
        const latest = current.current;
        if (!latest) return;
        const next = {
          ...latest,
          messages: latest.messages.map((message) =>
            message.id === messageId
              ? { ...message, readAt: result.data.readAt }
              : message,
          ),
          // Two independently committed receipts may arrive out of order. A
          // latest-page refresh replaces this count with the current DB view.
          readCount: Math.max(latest.readCount, result.data.readCount),
        };
        current.current = next;
        setData(next);
      } catch {
        if (active.current && generation.current === version)
          setReadErrors((previous) => new Set([...previous, messageId]));
      } finally {
        controllers.current.delete(controller);
        if (generation.current === version) {
          reading.current.delete(messageId);
          if (active.current) setReadPending(new Set(reading.current));
        }
      }
    },
    [clear],
  );

  const load = useCallback(
    async (older = false) => {
      if (!active.current || paging.current) return;
      const previous = current.current;
      if (older && !previous?.nextCursor) return;
      if (!older) {
        stop();
        setObservationEpoch((value) => value + 1);
        setReadPending(new Set());
        setReadErrors(new Set());
      }
      paging.current = true;
      lastOperation.current = older;
      setPending(older ? 'older' : 'refresh');
      setError(null);
      const controller = new AbortController();
      controllers.current.add(controller);
      const version = generation.current;
      try {
        const result = await readChatPage(
          {
            slug: initial.artist.slug,
            ...(older && previous?.nextCursor
              ? { cursor: previous.nextCursor }
              : {}),
          },
          controller.signal,
        );
        if (
          !active.current ||
          generation.current !== version ||
          controller.signal.aborted
        )
          return;
        if (!result.ok) {
          if (closesConversation(result.code)) clear(result.code);
          else setError(result.code);
          return;
        }
        if (!result.data.hasAccess) {
          clear('SUBSCRIPTION_REQUIRED');
          return;
        }
        const latest = current.current;
        const existing = new Set(latest?.messages.map((message) => message.id));
        const next =
          older && latest
            ? {
                ...result.data,
                messages: [
                  ...latest.messages,
                  ...result.data.messages.filter(
                    (message) => !existing.has(message.id),
                  ),
                ],
                readCount: Math.max(latest.readCount, result.data.readCount),
              }
            : result.data;
        current.current = next;
        setData(next);
      } catch {
        if (active.current && generation.current === version)
          setError('UNAVAILABLE');
      } finally {
        controllers.current.delete(controller);
        if (generation.current === version) {
          paging.current = false;
          if (active.current) setPending(null);
        }
      }
    },
    [clear, initial.artist.slug, stop],
  );

  useEffect(() => {
    active.current = true;
    const navigation = () => {
      clear();
      void load();
    };
    const hidden = () => clear();
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) void load();
    };
    window.addEventListener('popstate', navigation);
    window.addEventListener('pagehide', hidden);
    window.addEventListener('pageshow', restored);
    return () => {
      active.current = false;
      stop();
      window.removeEventListener('popstate', navigation);
      window.removeEventListener('pagehide', hidden);
      window.removeEventListener('pageshow', restored);
    };
  }, [clear, load, stop]);

  return {
    data,
    pending,
    error,
    readPending,
    readErrors,
    observationEpoch,
    markRead,
    load,
    retry: () => load(lastOperation.current),
    clear,
  };
}
