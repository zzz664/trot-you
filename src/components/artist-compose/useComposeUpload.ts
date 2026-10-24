'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  beginMediaUpload,
  completeMediaUpload,
  revokeMediaUpload,
  uploadMediaBytes,
} from '@/client/media';
import { ComposePhotoError, resizeComposePhoto } from '@/client/compose-photo';
import { COMPOSE_MEDIA_TYPES } from '@/config/compose-media';
import type { ComposeDraft, ComposePolicy } from '@/config/artist-compose';
import type {
  MediaError,
  MediaKind,
  MediaMime,
  MediaUploadGrant,
} from '@/config/media';

type Phase =
  'preparing' | 'ready' | 'uploading' | 'uncertain' | 'canceling' | null;
type Upload = {
  requestId: string;
  messageId: string;
  file: File;
  mimeType: MediaMime;
  grant: MediaUploadGrant | null;
  started: boolean;
  putAttempted: boolean;
};
type Props = {
  draft: ComposeDraft;
  policy: ComposePolicy;
  onBusy: (busy: boolean) => void;
  onChanged: () => Promise<boolean>;
  onAccessLost: () => void;
};
export function useComposeUpload(props: Props) {
  const callbacks = useRef(props);
  useEffect(() => {
    callbacks.current = props;
  }, [props]);
  const active = useRef(true);
  const generation = useRef(0);
  const pending = useRef<Upload | null>(null);
  const controller = useRef<AbortController | null>(null);
  const working = useRef(false);
  const [phase, setPhase] = useState<Phase>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<
    'uploadComplete' | 'canceledUpload' | null
  >(null);
  const mark = useCallback((next: Phase) => {
    setPhase(next);
    callbacks.current.onBusy(next !== null);
  }, []);
  const failure = useCallback(
    (code: MediaError) => {
      if (
        code === 'FORBIDDEN' ||
        code === 'UNAUTHENTICATED' ||
        code === 'NOT_FOUND'
      ) {
        pending.current = null;
        mark(null);
        callbacks.current.onAccessLost();
      } else {
        setError(code);
        mark('uncertain');
      }
    },
    [mark],
  );
  const select = useCallback(
    async (file: File) => {
      if (working.current || pending.current || !active.current) return;
      const { draft, policy } = callbacks.current;
      if (draft.kind === 'text') return;
      const kind: MediaKind = draft.kind;
      if (
        !(COMPOSE_MEDIA_TYPES[kind] as readonly string[]).includes(file.type)
      ) {
        setError('unsupported');
        return;
      }
      const maxBytes =
        kind === 'photo'
          ? policy.photoMaxBytes
          : kind === 'voice'
            ? policy.voiceMaxBytes
            : policy.videoMaxBytes;
      if (kind !== 'photo' && (file.size <= 0 || file.size > maxBytes)) {
        setError('tooLarge');
        return;
      }
      working.current = true;
      const owner = ++generation.current;
      controller.current = new AbortController();
      mark('preparing');
      setError(null);
      setNotice(null);
      try {
        const prepared =
          kind === 'photo'
            ? await resizeComposePhoto(
                file,
                maxBytes,
                controller.current.signal,
              )
            : file;
        if (
          !active.current ||
          owner !== generation.current ||
          controller.current.signal.aborted
        )
          return;
        pending.current = {
          requestId: crypto.randomUUID(),
          messageId: draft.id,
          file: prepared,
          mimeType: prepared.type as MediaMime,
          grant: null,
          started: false,
          putAttempted: false,
        };
        mark('ready');
      } catch (cause) {
        if (active.current && owner === generation.current) {
          setError(
            cause instanceof ComposePhotoError ? cause.code : 'unavailable',
          );
          mark(null);
        }
      } finally {
        if (owner === generation.current) {
          working.current = false;
          controller.current = null;
        }
      }
    },
    [mark],
  );
  const upload = useCallback(async () => {
    const item = pending.current;
    if (!item || working.current || !active.current) return;
    working.current = true;
    const owner = ++generation.current;
    const request = new AbortController();
    controller.current = request;
    mark('uploading');
    setError(null);
    item.started = true;
    const live = () =>
      active.current && owner === generation.current && !request.signal.aborted;
    try {
      if (!item.grant) {
        const begin = await beginMediaUpload(
          {
            requestId: item.requestId,
            messageId: item.messageId,
            mimeType: item.mimeType,
            byteSize: item.file.size,
          },
          request.signal,
        );
        if (!live()) return;
        if (!begin.ok) {
          failure(begin.code);
          return;
        }
        item.grant = begin.data;
      }
      if (!item.putAttempted) {
        // A lost PUT response is not permission to overwrite/re-upload. Recovery
        // checks the same intent's completion, never repeats its storage write.
        item.putAttempted = true;
        const put = await uploadMediaBytes(
          item.grant,
          item.file,
          request.signal,
        );
        if (!live()) return;
        if (!put.ok) {
          failure(put.code);
          return;
        }
      }
      const complete = await completeMediaUpload(
        { uploadId: item.grant.uploadId },
        request.signal,
      );
      if (!live()) return;
      if (!complete.ok) {
        failure(complete.code);
        return;
      }
      pending.current = null;
      mark(null);
      setNotice('uploadComplete');
      await callbacks.current.onChanged();
    } catch {
      if (live()) failure('UNAVAILABLE');
    } finally {
      if (owner === generation.current) {
        working.current = false;
        controller.current = null;
      }
    }
  }, [failure, mark]);
  const cancel = useCallback(async () => {
    if (!active.current || phase === 'canceling') return;
    const item = pending.current;
    const owner = ++generation.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    working.current = true;
    mark('canceling');
    setError(null);
    const live = () =>
      active.current && owner === generation.current && !request.signal.aborted;
    try {
      if (item?.started) {
        if (!item.grant) {
          const result = await beginMediaUpload(
            {
              requestId: item.requestId,
              messageId: item.messageId,
              mimeType: item.mimeType,
              byteSize: item.file.size,
            },
            request.signal,
          );
          if (!live()) return;
          if (!result.ok) {
            if (
              result.code === 'UNAVAILABLE' ||
              result.code === 'FORBIDDEN' ||
              result.code === 'UNAUTHENTICATED' ||
              result.code === 'NOT_FOUND'
            ) {
              failure(result.code);
              return;
            }
            // A definitive rejection/expired intent may have no usable grant.
            // Reconcile the owned draft and expose remaining pending IDs rather
            // than inventing another upload or trapping the editor forever.
            const refreshed = await callbacks.current.onChanged();
            if (!live()) return;
            if (!refreshed) {
              failure('UNAVAILABLE');
              return;
            }
            pending.current = null;
            mark(null);
            setNotice('canceledUpload');
            return;
          }
          item.grant = result.data;
        }
        const result = await revokeMediaUpload(
          { uploadId: item.grant.uploadId },
          request.signal,
        );
        if (!live()) return;
        if (!result.ok) {
          failure(result.code);
          return;
        }
      }
      if (!live()) return;
      pending.current = null;
      mark(null);
      setNotice('canceledUpload');
      if (item?.started) await callbacks.current.onChanged();
    } catch {
      if (live()) failure('UNAVAILABLE');
    } finally {
      if (owner === generation.current) {
        working.current = false;
        controller.current = null;
      }
    }
  }, [failure, mark, phase]);
  const clearPending = useCallback(async () => {
    if (working.current || pending.current || !active.current) return;
    const owner = ++generation.current;
    const request = new AbortController();
    controller.current = request;
    working.current = true;
    mark('canceling');
    setError(null);
    const live = () =>
      active.current && owner === generation.current && !request.signal.aborted;
    try {
      for (const uploadId of callbacks.current.draft.pendingUploadIds) {
        const result = await revokeMediaUpload({ uploadId }, request.signal);
        if (!live()) return;
        if (!result.ok) {
          setError(result.code);
          mark(null);
          if (result.code === 'FORBIDDEN' || result.code === 'UNAUTHENTICATED')
            callbacks.current.onAccessLost();
          return;
        }
      }
      mark(null);
      setNotice('canceledUpload');
      await callbacks.current.onChanged();
    } catch {
      if (live()) {
        setError('UNAVAILABLE');
        mark(null);
      }
    } finally {
      if (owner === generation.current) {
        working.current = false;
        controller.current = null;
      }
    }
  }, [mark]);
  useEffect(() => {
    active.current = true;
    const release = () => {
      generation.current += 1;
      controller.current?.abort();
      pending.current = null;
      working.current = false;
      mark(null);
    };
    window.addEventListener('pagehide', release);
    return () => {
      active.current = false;
      generation.current += 1;
      controller.current?.abort();
      pending.current = null;
      window.removeEventListener('pagehide', release);
    };
  }, [mark]);
  return { phase, error, notice, select, upload, cancel, clearPending };
}
