'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  beginCommunityImage,
  uploadCommunityImage,
  completeCommunityImage,
  revokeCommunityImage,
} from '@/client/community-media';
import {
  communityImageBeginSchema,
  type CommunityImageBegin,
  type CommunityImageGrant,
} from '@/config/community-media';
import type { CommunityError, CommunityPolicy } from '@/config/community-posts';
type Prepared = { uploadId: string; imageId: string };
type Pending = {
  file: File;
  input: CommunityImageBegin;
  grant: CommunityImageGrant | null;
  stage: 'begin' | 'upload' | 'complete';
  attempted: boolean;
};
export function useCommunityImages({
  artistId,
  postId,
  actorKey,
  policy,
  onAccessLost,
}: {
  artistId: string;
  postId: string;
  actorKey: string;
  policy: CommunityPolicy;
  onAccessLost: () => void;
}) {
  const [items, setItems] = useState<Prepared[]>([]);
  const prepared = useRef<Prepared[]>([]);
  const [phase, setPhase] = useState<'ready' | 'working' | 'uncertain' | null>(
    null,
  );
  const [error, setError] = useState<CommunityError | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const pending = useRef<Pending | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const alive = useRef(false);
  const running = useRef(false);
  const removing = useRef<string | null>(null);
  const callback = useRef(onAccessLost);
  useEffect(() => {
    callback.current = onAccessLost;
  }, [onAccessLost]);
  const stop = useCallback(() => {
    generation.current += 1;
    request.current?.abort();
    request.current = null;
    running.current = false;
    if (pending.current?.attempted || removing.current) setPhase('uncertain');
  }, []);
  useEffect(() => {
    alive.current = true;
    const visibility = () => {
      if (document.visibilityState === 'hidden') stop();
    };
    window.addEventListener('pagehide', stop);
    window.addEventListener('popstate', stop);
    window.addEventListener('focus', stop);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive.current = false;
      stop();
      window.removeEventListener('pagehide', stop);
      window.removeEventListener('popstate', stop);
      window.removeEventListener('focus', stop);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [stop]);
  function fail(code: CommunityError) {
    setError(code);
    setPhase('uncertain');
    if (code === 'FORBIDDEN' || code === 'UNAUTHENTICATED') {
      pending.current = null;
      removing.current = null;
      setCancelRequested(false);
      prepared.current = [];
      setItems([]);
      setPhase(null);
      callback.current();
    }
  }
  function beginFailure(code: CommunityError) {
    // An expired begin with no grant means this client never sent file bytes.
    // The server has confirmed the reservation is unusable; no post exists.
    if (code === 'EXPIRED') {
      pending.current = null;
      removing.current = null;
      setCancelRequested(false);
      setPhase(null);
      setError(code);
    } else fail(code);
  }
  function select(file: File) {
    if (
      running.current ||
      pending.current ||
      removing.current ||
      prepared.current.length >= policy.max_images
    )
      return;
    const parsed = communityImageBeginSchema.safeParse({
      requestId: crypto.randomUUID(),
      artistId,
      postId,
      mimeType: file.type,
      byteSize: file.size,
    });
    if (!parsed.success || file.size > policy.max_image_bytes) {
      setError('INVALID_CONTENT');
      return;
    }
    pending.current = {
      file,
      input: parsed.data,
      grant: null,
      stage: 'begin',
      attempted: false,
    };
    setError(null);
    setPhase('ready');
  }
  async function run() {
    if (running.current || !pending.current) return;
    running.current = true;
    const owner = ++generation.current;
    const controller = new AbortController();
    request.current = controller;
    setPhase('working');
    setError(null);
    const valid = () =>
      alive.current &&
      owner === generation.current &&
      !controller.signal.aborted;
    try {
      const operation = pending.current;
      operation.attempted = true;
      if (operation.stage === 'begin') {
        const result = await beginCommunityImage(
          operation.input,
          controller.signal,
          actorKey,
        );
        if (!valid()) return;
        if (!result.ok) {
          beginFailure(result.code);
          return;
        }
        operation.grant = result.data;
        operation.stage = 'upload';
      }
      if (operation.stage === 'upload') {
        if (!operation.grant) {
          fail('UNAVAILABLE');
          return;
        } // The PUT may commit even when its response is lost. Never repeat it.
        operation.stage = 'complete';
        const result = await uploadCommunityImage(
          operation.grant,
          operation.file,
          controller.signal,
        );
        if (!valid()) return;
        if (!result.ok) {
          fail(result.code);
          return;
        }
      }
      const result = await completeCommunityImage(
        { uploadId: operation.grant!.uploadId },
        controller.signal,
        actorKey,
      );
      if (!valid()) return;
      if (!result.ok) {
        fail(result.code);
        return;
      }
      prepared.current = [
        ...prepared.current,
        { uploadId: operation.grant!.uploadId, imageId: result.data.imageId },
      ];
      setItems(prepared.current);
      pending.current = null;
      setPhase(null);
    } catch {
      if (valid()) fail('UNAVAILABLE');
    } finally {
      if (owner === generation.current) {
        running.current = false;
        request.current = null;
      }
    }
  }
  async function remove(uploadId?: string): Promise<boolean> {
    if (running.current) return false;
    const operation = pending.current;
    if (!uploadId && !operation && !removing.current) return true;
    setCancelRequested(true);
    if (!uploadId && operation && !operation.attempted) {
      pending.current = null;
      setCancelRequested(false);
      setPhase(null);
      setError(null);
      return true;
    }
    running.current = true;
    const owner = ++generation.current;
    const controller = new AbortController();
    request.current = controller;
    setPhase('working');
    setError(null);
    const valid = () =>
      alive.current &&
      owner === generation.current &&
      !controller.signal.aborted;
    try {
      let id = removing.current ?? uploadId ?? operation?.grant?.uploadId;
      if (!id && operation) {
        operation.attempted = true;
        const result = await beginCommunityImage(
          operation.input,
          controller.signal,
          actorKey,
        );
        if (!valid()) return false;
        if (!result.ok) {
          beginFailure(result.code);
          return result.code === 'EXPIRED';
        }
        operation.grant = result.data;
        id = result.data.uploadId;
      }
      if (!id) {
        fail('UNAVAILABLE');
        return false;
      }
      removing.current = id;
      const result = await revokeCommunityImage(
        { uploadId: id },
        controller.signal,
        actorKey,
      );
      if (!valid()) return false;
      if (!result.ok) {
        fail(result.code);
        return false;
      }
      prepared.current = prepared.current.filter(
        (item) => item.uploadId !== id,
      );
      setItems(prepared.current);
      if (operation?.grant?.uploadId === id) pending.current = null;
      removing.current = null;
      setCancelRequested(false);
      setPhase(null);
      return true;
    } catch {
      if (valid()) fail('UNAVAILABLE');
      return false;
    } finally {
      if (owner === generation.current) {
        running.current = false;
        request.current = null;
      }
    }
  }
  async function cancelAll(): Promise<boolean> {
    // This is explicit composer cancellation, not page abandonment. Abort the
    // transport, then reconcile the exact reservation before releasing slots.
    stop();
    const recoveringId = removing.current ?? pending.current?.grant?.uploadId;
    if ((pending.current || removing.current) && !(await remove()))
      return false;
    for (const item of [...prepared.current]) {
      if (item.uploadId !== recoveringId && !(await remove(item.uploadId)))
        return false;
    }
    return true;
  }

  return {
    items,
    phase,
    error,
    select,
    upload: run,
    remove,
    cancelAll,
    hasPending: phase !== null,
    recoverRemoval: cancelRequested,
  };
}
