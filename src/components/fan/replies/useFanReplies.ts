'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readReplyPage, sendReply } from '@/client/replies';
import type { ChatError } from '@/config/chat';
import type { ReplyError, ReplyPage, ReplyWriteInput } from '@/config/replies';

function closesRoom(
  code: ReplyError,
): code is
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'SUBSCRIPTION_REQUIRED'
  | 'PROFILE_REQUIRED'
  | 'NOT_FOUND' {
  return (
    code === 'UNAUTHENTICATED' ||
    code === 'FORBIDDEN' ||
    code === 'SUBSCRIPTION_REQUIRED' ||
    code === 'PROFILE_REQUIRED' ||
    code === 'NOT_FOUND'
  );
}

export function useFanReplies(
  slug: string,
  onAccessLost: (code: ChatError) => void,
) {
  const active = useRef(true);
  const generation = useRef(0);
  const paging = useRef(false);
  const sending = useRef(false);
  const current = useRef<ReplyPage | null>(null);
  const operation = useRef<ReplyWriteInput | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const failedPage = useRef(false);
  const accessLost = useRef(onAccessLost);
  const [data, setData] = useState<ReplyPage | null>(null);
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(true);
  const [pending, setPending] = useState<'refresh' | 'older' | null>(null);
  const [sendPending, setSendPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [pageError, setPageError] = useState<ReplyError | null>(null);
  const [sendError, setSendError] = useState<ReplyError | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    accessLost.current = onAccessLost;
  }, [onAccessLost]);
  const stop = useCallback(() => {
    generation.current += 1;
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    paging.current = false;
    sending.current = false;
  }, []);
  const clear = useCallback(
    (code?: ChatError) => {
      stop();
      current.current = null;
      operation.current = null;
      setData(null);
      setDraft('');
      setUncertain(false);
      setSendPending(false);
      setPending(null);
      setSendError(null);
      setPageError(null);
      setSent(false);
      if (code) accessLost.current(code);
    },
    [stop],
  );

  const load = useCallback(
    async (older = false) => {
      if (
        !active.current ||
        paging.current ||
        sending.current ||
        operation.current
      )
        return;
      const previous = current.current;
      if (older && !previous?.nextCursor) return;
      paging.current = true;
      failedPage.current = older;
      setPending(older ? 'older' : 'refresh');
      setPageError(null);
      const version = generation.current;
      const controller = new AbortController();
      controllers.current.add(controller);
      try {
        const result = await readReplyPage(
          {
            slug,
            ...(older && previous?.nextCursor
              ? { cursor: previous.nextCursor }
              : {}),
          },
          controller.signal,
        );
        if (
          !active.current ||
          version !== generation.current ||
          controller.signal.aborted
        )
          return;
        if (!result.ok) {
          if (closesRoom(result.code)) clear(result.code);
          else setPageError(result.code);
          return;
        }
        const latest = current.current;
        const ids = new Set(latest?.replies.map((reply) => reply.id));
        const next =
          older && latest
            ? {
                ...result.data,
                replies: [
                  ...latest.replies,
                  ...result.data.replies.filter((reply) => !ids.has(reply.id)),
                ],
              }
            : result.data;
        current.current = next;
        setData(next);
      } catch {
        if (active.current && version === generation.current)
          setPageError('UNAVAILABLE');
      } finally {
        controllers.current.delete(controller);
        if (version === generation.current) {
          paging.current = false;
          if (active.current) setPending(null);
        }
      }
    },
    [clear, slug],
  );

  const submit = useCallback(async () => {
    if (
      !active.current ||
      sending.current ||
      paging.current ||
      !current.current?.sendReady
    )
      return;
    const prior = operation.current;
    if (!prior) {
      if (!draft.trim()) {
        setSendError('INVALID_INPUT');
        return;
      }
      if (Array.from(draft).length > current.current.maxLength) {
        setSendError('TOO_LONG');
        return;
      }
      try {
        operation.current = {
          slug,
          operationId: crypto.randomUUID(),
          body: draft,
          messageId: null,
        };
      } catch {
        setSendError('UNAVAILABLE');
        return;
      }
    }
    const input = operation.current!;
    sending.current = true;
    setSendPending(true);
    setSendError(null);
    setSent(false);
    const version = generation.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const result = await sendReply(input, controller.signal);
      if (
        !active.current ||
        version !== generation.current ||
        controller.signal.aborted
      )
        return;
      if (!result.ok) {
        if (closesRoom(result.code)) {
          clear(result.code);
          return;
        }
        // These outcomes do not establish that this operation has no committed
        // effect. Keep its immutable payload/key; only explicit same-key retry.
        const unknown =
          prior !== null ||
          result.code === 'UNAVAILABLE' ||
          result.code === 'IDEMPOTENCY_CONFLICT';
        if (!unknown) operation.current = null;
        setUncertain(unknown);
        setSendError(result.code);
        return;
      }
      const latest = current.current;
      if (!latest) return;
      const reply = result.data.reply;
      const next = {
        ...latest,
        replies: [
          reply,
          ...latest.replies.filter((item) => item.id !== reply.id),
        ],
      };
      current.current = next;
      setData(next);
      operation.current = null;
      setDraft('');
      setUncertain(false);
      setSent(true);
    } catch {
      if (active.current && version === generation.current) {
        setUncertain(true);
        setSendError('UNAVAILABLE');
      }
    } finally {
      controllers.current.delete(controller);
      if (version === generation.current) {
        sending.current = false;
        if (active.current) setSendPending(false);
      }
    }
  }, [clear, draft, slug]);

  useEffect(() => {
    active.current = true;
    void load();
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
    draft,
    open,
    pending,
    sendPending,
    uncertain,
    pageError,
    sendError,
    sent,
    load,
    submit,
    retryPage: () => load(failedPage.current),
    setOpen,
    edit(value: string) {
      if (sending.current || operation.current) return;
      setDraft(value);
      setSendError(null);
      setSent(false);
    },
  };
}
