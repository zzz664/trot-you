'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  previewComposeDraft,
  readComposePage,
  removeComposeMedia,
  saveComposeDraft,
} from '@/client/compose';
import type {
  ComposeDraft,
  ComposeError,
  ComposeKind,
  ComposePageData,
  ComposePreview,
  ComposeRemoveInput,
  ComposeSaveInput,
} from '@/config/artist-compose';
import { artistComposePath } from '@/config/routes';

type Operation =
  | { kind: 'save'; input: ComposeSaveInput }
  | { kind: 'remove'; input: ComposeRemoveInput };
function losesAccess(code: ComposeError) {
  return (
    code === 'FORBIDDEN' || code === 'UNAUTHENTICATED' || code === 'NOT_FOUND'
  );
}
export function useArtistCompose(initial: ComposePageData) {
  const [data, setData] = useState<ComposePageData | null>(initial);
  const [selected, setSelected] = useState<ComposeDraft | null>(
    initial.selectedDraft,
  );
  const [kind, setKind] = useState<ComposeKind>(
    initial.selectedDraft?.kind ?? 'text',
  );
  const [body, setBody] = useState(initial.selectedDraft?.body ?? '');
  const [sampleName, setSampleName] = useState('');
  const [preview, setPreview] = useState<ComposePreview | null>(null);
  const [error, setError] = useState<ComposeError | null>(null);
  const [busy, setBusy] = useState<
    'page' | 'save' | 'remove' | 'preview' | null
  >(null);
  const [mediaBusy, setMediaBusyState] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const needsRefresh = useRef(false);
  const [saved, setSaved] = useState(false);
  const [accessLost, setAccessLost] = useState(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const running = useRef(false);
  const mediaRunning = useRef(false);
  const current = useRef(initial);
  const selection = useRef(initial.selectedDraft);
  const operation = useRef<Operation | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const slug = initial.artist.slug;
  const dirty =
    body !== (selected?.body ?? '') || kind !== (selected?.kind ?? 'text');
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const stop = useCallback(() => {
    generation.current += 1;
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    running.current = false;
    mediaRunning.current = false;
  }, []);
  const clear = useCallback(
    (lost = false) => {
      stop();
      operation.current = null;
      needsRefresh.current = false;
      setRefreshRequired(false);
      selection.current = null;
      current.current = {
        ...current.current,
        drafts: [],
        selectedDraft: null,
        hasMore: false,
        nextCursor: null,
      };
      setData(null);
      setSelected(null);
      setBody('');
      setKind('text');
      setSampleName('');
      setPreview(null);
      setError(null);
      setUncertain(false);
      setSaved(false);
      setBusy(null);
      setMediaBusyState(false);
      setAccessLost(lost);
    },
    [stop],
  );
  const handleError = useCallback(
    (code: ComposeError) => {
      if (losesAccess(code)) clear(true);
      else setError(code);
    },
    [clear],
  );
  const putDraft = useCallback(
    (draft: ComposeDraft) => {
      selection.current = draft;
      setSelected(draft);
      setKind(draft.kind);
      setBody(draft.body ?? '');
      setPreview(null);
      const next = {
        ...current.current,
        selectedDraft: draft,
        drafts: [
          draft,
          ...current.current.drafts.filter((item) => item.id !== draft.id),
        ],
      };
      current.current = next;
      setData(next);
      window.history.replaceState(
        window.history.state,
        '',
        artistComposePath(slug, draft.id),
      );
    },
    [slug],
  );
  const load = useCallback(
    async (
      messageId: string | null = selection.current?.id ?? null,
      older = false,
      navigation = false,
    ) => {
      if (
        !alive.current ||
        running.current ||
        (mediaRunning.current && !navigation)
      )
        return false;
      const cursor = older ? current.current.nextCursor : null;
      if (older && !cursor) return false;
      running.current = true;
      setBusy('page');
      setError(null);
      setSaved(false);
      const owner = generation.current;
      const controller = new AbortController();
      controllers.current.add(controller);
      try {
        const result = await readComposePage(
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
          handleError(result.code);
          return false;
        }
        const next = older
          ? {
              ...result.data,
              drafts: [
                ...current.current.drafts,
                ...result.data.drafts.filter(
                  (draft) =>
                    !current.current.drafts.some(
                      (item) => item.id === draft.id,
                    ),
                ),
              ],
            }
          : result.data;
        current.current = next;
        setData(next);
        setAccessLost(false);
        if (!older) {
          operation.current = null;
          needsRefresh.current = false;
          setRefreshRequired(false);
          setUncertain(false);
          selection.current = next.selectedDraft;
          setSelected(next.selectedDraft);
          setBody(next.selectedDraft?.body ?? '');
          setKind(next.selectedDraft?.kind ?? 'text');
          setPreview(null);
          window.history.replaceState(
            window.history.state,
            '',
            artistComposePath(slug, messageId ?? undefined),
          );
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
    [handleError, slug],
  );
  const mutate = useCallback(
    async (candidate?: Operation) => {
      if (!alive.current || running.current || mediaRunning.current) return;
      const replay = operation.current !== null;
      if (!operation.current && candidate) operation.current = candidate;
      const pending = operation.current;
      if (!pending) return;
      running.current = true;
      setBusy(pending.kind);
      setError(null);
      setSaved(false);
      const owner = generation.current;
      const controller = new AbortController();
      controllers.current.add(controller);
      // The preallocated ID makes a refresh after a lost create response resolve
      // the original resource instead of silently creating a second draft.
      window.history.replaceState(
        window.history.state,
        '',
        artistComposePath(slug, pending.input.messageId),
      );
      try {
        const result =
          pending.kind === 'save'
            ? await saveComposeDraft(pending.input, controller.signal)
            : await removeComposeMedia(pending.input, controller.signal);
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
          if (!unknown) {
            operation.current = null;
            if (
              pending.kind === 'save' &&
              pending.input.expectedRevision === 0
            ) {
              window.history.replaceState(
                window.history.state,
                '',
                artistComposePath(slug),
              );
            }
          }
          setUncertain(unknown);
          setError(result.code);
          return;
        }
        let accepted = result.data;
        if (replay) {
          // Idempotent mutation receipts intentionally describe the original
          // commit, not a newer edit from another tab. Re-read before allowing
          // this editor to resume; a failed read keeps the same operation frozen.
          const fresh = await readComposePage(
            { slug, messageId: pending.input.messageId },
            controller.signal,
          );
          if (
            !alive.current ||
            owner !== generation.current ||
            controller.signal.aborted
          )
            return;
          if (
            !fresh.ok ||
            !fresh.data.selectedDraft ||
            fresh.data.selectedDraft.revision < accepted.revision
          ) {
            if (!fresh.ok && losesAccess(fresh.code)) {
              clear(true);
              return;
            }
            setUncertain(true);
            setError(!fresh.ok ? fresh.code : 'UNAVAILABLE');
            return;
          }
          current.current = fresh.data;
          accepted = fresh.data.selectedDraft;
        }
        operation.current = null;
        setUncertain(false);
        putDraft(accepted);
        setSaved(true);
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
    [clear, putDraft, slug],
  );
  const save = useCallback(async () => {
    if (running.current || mediaRunning.current) return;
    if (needsRefresh.current) return load(selection.current?.id ?? null);
    if (operation.current) return mutate();
    if (Array.from(body).length > current.current.policy.maxTextLength) {
      setError('TOO_LONG');
      return;
    }
    if (kind === 'text' && !body.trim()) {
      setError('INVALID_INPUT');
      return;
    }
    try {
      await mutate({
        kind: 'save',
        input: {
          slug,
          messageId: selection.current?.id ?? crypto.randomUUID(),
          operationId: crypto.randomUUID(),
          expectedRevision: selection.current?.revision ?? 0,
          kind,
          body: body || null,
          mediaIds: selection.current?.media.map((item) => item.id) ?? [],
        },
      });
    } catch {
      setError('UNAVAILABLE');
    }
  }, [body, kind, load, mutate, slug]);
  const remove = useCallback(
    async (mediaId: string) => {
      if (
        running.current ||
        mediaRunning.current ||
        dirtyRef.current ||
        needsRefresh.current ||
        operation.current ||
        !selection.current
      )
        return;
      try {
        await mutate({
          kind: 'remove',
          input: {
            slug,
            messageId: selection.current.id,
            mediaId,
            operationId: crypto.randomUUID(),
            expectedRevision: selection.current.revision,
          },
        });
      } catch {
        setError('UNAVAILABLE');
      }
    },
    [mutate, slug],
  );
  const showPreview = useCallback(async () => {
    if (
      !alive.current ||
      running.current ||
      mediaRunning.current ||
      operation.current ||
      needsRefresh.current
    )
      return;
    if (Array.from(body).length > current.current.policy.maxTextLength) {
      setError('TOO_LONG');
      return;
    }
    const nameLength = Array.from(sampleName.trim()).length;
    if (
      nameLength < current.current.policy.callNameMinLength ||
      nameLength > current.current.policy.callNameMaxLength
    ) {
      setError('NAME_INVALID');
      return;
    }
    running.current = true;
    setBusy('preview');
    setError(null);
    setPreview(null);
    const owner = generation.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const result = await previewComposeDraft(
        {
          slug,
          messageId: selection.current?.id ?? null,
          kind,
          body: body || null,
          sampleName,
        },
        controller.signal,
      );
      if (
        !alive.current ||
        owner !== generation.current ||
        controller.signal.aborted
      )
        return;
      if (!result.ok) handleError(result.code);
      else setPreview(result.data);
    } catch {
      if (alive.current && owner === generation.current)
        setError('UNAVAILABLE');
    } finally {
      controllers.current.delete(controller);
      if (owner === generation.current) {
        running.current = false;
        if (alive.current) setBusy(null);
      }
    }
  }, [body, handleError, kind, sampleName, slug]);
  useEffect(() => {
    alive.current = true;
    const navigate = () => {
      const id = new URL(window.location.href).searchParams.get('draft');
      clear();
      void load(id, false, true);
    };
    const hide = () => clear();
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) navigate();
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (
        dirtyRef.current ||
        running.current ||
        mediaRunning.current ||
        operation.current
      )
        event.preventDefault();
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
  }, [clear, load, stop]);
  return {
    data,
    selected,
    kind,
    body,
    sampleName,
    preview,
    error,
    busy,
    mediaBusy,
    uncertain,
    refreshRequired,
    saved,
    accessLost,
    dirty,
    save,
    remove,
    load,
    showPreview,
    retryMutation: () => mutate(),
    edit(value: string) {
      if (
        running.current ||
        mediaRunning.current ||
        operation.current ||
        needsRefresh.current
      )
        return;
      setBody(value);
      setError(null);
      setSaved(false);
      setPreview(null);
    },
    chooseKind(value: ComposeKind) {
      if (
        running.current ||
        mediaRunning.current ||
        operation.current ||
        needsRefresh.current ||
        selection.current?.media.length ||
        selection.current?.pendingUploadIds.length
      )
        return;
      setKind(value);
      setError(null);
      setSaved(false);
      setPreview(null);
    },
    editName(value: string) {
      if (running.current || mediaRunning.current || needsRefresh.current)
        return;
      setSampleName(value);
      setPreview(null);
      if (error === 'NAME_INVALID') setError(null);
    },
    setMediaBusy(value: boolean) {
      mediaRunning.current = value;
      setMediaBusyState(value);
    },
    mediaAccessLost() {
      clear(true);
    },
    async mediaChanged() {
      const accepted = await load(selection.current?.id ?? null, false, true);
      if (!accepted && alive.current && selection.current !== null) {
        needsRefresh.current = true;
        setRefreshRequired(true);
        setUncertain(true);
      }
      return accepted;
    },
  };
}
