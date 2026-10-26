'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  fetchCommunityInteractions,
  createCommunityComment,
  updateCommunityComment,
  deleteCommunityComment,
  setCommunityLike,
} from '@/client/community-interactions';
import {
  COMMUNITY_INTERACTIONS,
  communityCommentCreateSchema,
  communityCommentUpdateSchema,
  type CommunityComment,
  type CommunityCommentCursor,
  type CommunityCommentCreateInput,
  type CommunityCommentUpdateInput,
  type CommunityCommentDeleteInput,
  type CommunityLikeInput,
} from '@/config/community-interactions';
import type {
  CommunityDetail,
  CommunityError,
  CommunityResult,
} from '@/config/community-posts';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { Loading } from '@/components/ui/Loading';
import { InlineError } from '@/components/ui/InlineError';
import { useDialog } from '@/components/ui/DialogProvider';
import { useCommunityResource } from '@/components/community-posts/useCommunityResource';
import styles from './community-interactions.module.css';

type Intent =
  | { kind: 'create'; input: CommunityCommentCreateInput }
  | { kind: 'update'; input: CommunityCommentUpdateInput }
  | { kind: 'delete'; input: CommunityCommentDeleteInput }
  | { kind: 'like'; input: CommunityLikeInput };
type Props = {
  slug: string;
  postId: string;
  actorKey: string;
  path: string;
  parentSnapshot: CommunityDetail | null;
  parentError: CommunityError | null;
  disabled: boolean;
  onAccessLost: (code: CommunityError) => void;
  onChanged: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
};
function losesAccess(code: CommunityError | null) {
  return (
    code === 'FORBIDDEN' ||
    code === 'UNAUTHENTICATED' ||
    code === 'NOT_FOUND' ||
    code === 'SETUP_NOT_READY'
  );
}

// A changed actor/target destroys the prior private draft and immutable intent.
// Ordinary parent refreshes do not remount this session: uncertain operations
// must retain their original identifiers until an explicit same-account retry.
export function CommunityInteractions(props: Props) {
  return (
    <InteractionSession
      key={`${props.actorKey}:${props.slug}:${props.postId}`}
      {...props}
    />
  );
}
function InteractionSession({
  slug,
  postId,
  actorKey,
  path,
  parentSnapshot,
  parentError,
  disabled,
  onAccessLost,
  onChanged,
  onBusyChange,
}: Props) {
  const t = useTranslations('communityInteractions');
  const errors = useTranslations('communityPosts.errors');
  const format = useFormatter();
  const { showDialog, cancelDialog } = useDialog();
  const [body, setBody] = useState('');
  const [validatedSnapshot, setValidatedSnapshot] =
    useState<CommunityDetail | null>(null);
  const [editor, setEditor] = useState<{
    comment: CommunityComment;
    body: string;
  } | null>(null);
  const [invalidBody, setInvalidBody] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pendingKind, setPendingKind] = useState<Intent['kind'] | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [saved, setSaved] = useState<Intent['kind'] | null>(null);
  const [pageCursor, setPageCursor] = useState<CommunityCommentCursor | null>(
    null,
  );
  const cursor = useRef<CommunityCommentCursor | null>(null);
  const pending = useRef<Intent | null>(null);
  const running = useRef(false);
  const alive = useRef(false);
  const currentSnapshot = useRef(parentSnapshot);
  const available =
    parentSnapshot?.actor_id === actorKey &&
    parentSnapshot.post.id === postId &&
    !losesAccess(parentError);
  const erase = useCallback(() => {
    pending.current = null;
    cursor.current = null;
    setPageCursor(null);
    setPendingKind(null);
    setUncertain(false);
    setBody('');
    setEditor(null);
    setInvalidBody(false);
    setSaved(null);
  }, []);
  const load = useCallback(
    async (signal: AbortSignal) => {
      // The stable session may remain mounted while the parent discards private
      // data. Never read or render against an unvalidated parent snapshot.
      if (
        !parentSnapshot ||
        parentSnapshot.actor_id !== actorKey ||
        parentSnapshot.post.id !== postId ||
        losesAccess(parentError)
      )
        return { ok: false as const, code: 'UNAVAILABLE' as const };
      const result = await fetchCommunityInteractions(
        { slug, post_id: postId, cursor: cursor.current },
        signal,
        actorKey,
      );
      if (!signal.aborted && result.ok) setValidatedSnapshot(parentSnapshot);
      if (!signal.aborted && !result.ok && losesAccess(result.code)) {
        erase();
        onAccessLost(result.code);
      }
      return result;
    },
    // The fresh parent object is also an invalidation token when its revision
    // did not change (for example a no-op desired-like receipt).
    [parentSnapshot, parentError, slug, postId, actorKey, erase, onAccessLost],
  );
  const state = useCommunityResource(path, load);
  const data = validatedSnapshot === parentSnapshot ? state.data : null;
  const interrupt = useCallback(() => {
    cancelDialog(COMMUNITY_INTERACTIONS.deleteDialogKey);
    setConfirming(false);
    setEditor(null);
    setInvalidBody(false);
    setSaved(null);
    if (pending.current) setUncertain(true);
  }, [cancelDialog]);
  useEffect(() => {
    alive.current = true;
    const visibility = () => {
      if (document.visibilityState === 'hidden') interrupt();
    };
    window.addEventListener('pagehide', interrupt);
    window.addEventListener('popstate', interrupt);
    window.addEventListener('focus', interrupt);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive.current = false;
      cancelDialog(COMMUNITY_INTERACTIONS.deleteDialogKey);
      window.removeEventListener('pagehide', interrupt);
      window.removeEventListener('popstate', interrupt);
      window.removeEventListener('focus', interrupt);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [cancelDialog, interrupt]);
  useEffect(() => {
    currentSnapshot.current = parentSnapshot;
    cancelDialog(COMMUNITY_INTERACTIONS.deleteDialogKey);
    queueMicrotask(() => {
      if (!alive.current || currentSnapshot.current !== parentSnapshot) return;
      setEditor(null);
      setInvalidBody(false);
      setConfirming(false);
      if (!available) {
        if (pending.current) setUncertain(true);
      }
      if (losesAccess(parentError)) erase();
    });
  }, [available, parentSnapshot, parentError, erase, cancelDialog]);
  useEffect(() => {
    onBusyChange(state.busy || confirming || pendingKind !== null);
    return () => onBusyChange(false);
  }, [state.busy, confirming, pendingKind, onBusyChange]);

  async function run(intent?: Intent) {
    if (running.current || state.busy || disabled || !available) return;
    const operation = pending.current ?? intent;
    if (!operation) return;
    running.current = true;
    pending.current = operation;
    setPendingKind(operation.kind);
    setUncertain(false);
    setSaved(null);
    try {
      const result = await state.execute<unknown>(
        (signal): Promise<CommunityResult<unknown>> => {
          switch (operation.kind) {
            case 'create':
              return createCommunityComment(
                slug,
                operation.input,
                signal,
                actorKey,
              );
            case 'update':
              return updateCommunityComment(
                slug,
                operation.input,
                signal,
                actorKey,
              );
            case 'delete':
              return deleteCommunityComment(
                slug,
                operation.input,
                signal,
                actorKey,
              );
            case 'like':
              return setCommunityLike(slug, operation.input, signal, actorKey);
          }
        },
      );
      if (!alive.current) return;
      if (!result || (!result.ok && result.code === 'UNAVAILABLE')) {
        // A request may have committed even when a navigation/timeout aborted
        // its response. Never create a new operation or resend automatically.
        if (pending.current === operation) setUncertain(true);
        return;
      }
      if (pending.current !== operation) return;
      pending.current = null;
      setPendingKind(null);
      setUncertain(false);
      if (result.ok) {
        if (operation.kind === 'create') setBody('');
        setEditor(null);
        setSaved(operation.kind);
        cursor.current = null;
        setPageCursor(null);
        // Counter changes also advance posts.revision. Refresh the parent so
        // its owner delete/notice CAS token is not stale after our own write.
        await onChanged();
      } else if (losesAccess(result.code)) {
        erase();
        onAccessLost(result.code);
      } else if (result.code === 'CONFLICT') {
        setEditor(null);
        state.setData(null);
      }
    } finally {
      running.current = false;
    }
  }
  function create() {
    if (!data || pending.current || editor) return;
    const input = {
      operation_id: crypto.randomUUID(),
      post_id: postId,
      comment_id: crypto.randomUUID(),
      body,
    };
    if (
      !communityCommentCreateSchema.safeParse(input).success ||
      Array.from(body).length > data.policy.max_comment_length
    ) {
      setInvalidBody(true);
      return;
    }
    setInvalidBody(false);
    void run({ kind: 'create', input });
  }
  function update() {
    if (!data || !editor || pending.current) return;
    const input = {
      operation_id: crypto.randomUUID(),
      post_id: postId,
      comment_id: editor.comment.id,
      expected_revision: editor.comment.revision,
      body: editor.body,
    };
    if (
      !communityCommentUpdateSchema.safeParse(input).success ||
      Array.from(editor.body).length > data.policy.max_comment_length
    ) {
      setInvalidBody(true);
      return;
    }
    setInvalidBody(false);
    void run({ kind: 'update', input });
  }
  async function remove(comment: CommunityComment) {
    if (
      running.current ||
      state.busy ||
      disabled ||
      pending.current ||
      !available
    )
      return;
    running.current = true;
    setConfirming(true);
    const snapshot = currentSnapshot.current;
    try {
      const answer = await showDialog({
        key: COMMUNITY_INTERACTIONS.deleteDialogKey,
        title: t('deleteDialogTitle'),
        description: t('deleteDialogDescription'),
        confirmLabel: t('deleteDialogConfirm'),
        cancelLabel: t('deleteDialogCancel'),
      });
      if (!alive.current) return;
      setConfirming(false);
      if (answer !== 'confirmed' || snapshot !== currentSnapshot.current)
        return;
    } finally {
      running.current = false;
    }
    await run({
      kind: 'delete',
      input: {
        operation_id: crypto.randomUUID(),
        post_id: postId,
        comment_id: comment.id,
        expected_revision: comment.revision,
        confirmed: true,
      },
    });
  }
  async function refresh() {
    setEditor(null);
    setInvalidBody(false);
    setSaved(null);
    await state.refresh();
  }
  function page(next: CommunityCommentCursor | null) {
    if (pending.current || running.current || state.busy || disabled) return;
    cursor.current = next;
    setPageCursor(next);
    void refresh();
  }
  if (!available) return null;
  const frozen = disabled || state.busy || confirming || pendingKind !== null;
  return (
    <section
      className={styles.section}
      data-testid="community-interactions"
      aria-busy={state.busy}
    >
      <h2>{t('title')}</h2>
      <Button
        variant="secondary"
        disabled={disabled || state.busy || confirming}
        onClick={() => void refresh()}
      >
        {t('refresh')}
      </Button>
      {state.busy && <Loading label={t('loading')} />}
      {state.error && !uncertain && (
        <InlineError message={errors(state.error)} onRetry={refresh} />
      )}
      {saved && (
        <p role="status">
          {t(
            saved === 'delete'
              ? 'deleted'
              : saved === 'like'
                ? 'likeSaved'
                : 'saved',
          )}
        </p>
      )}
      {uncertain && (
        <section
          className={styles.recovery}
          data-testid="community-interactions-recovery"
        >
          <p role="alert">{t('uncertain')}</p>
          <Button
            disabled={disabled || state.busy || confirming}
            onClick={() => void run()}
          >
            {t('retryOperation')}
          </Button>
        </section>
      )}
      {data && (
        <div
          className={styles.stack}
          data-testid="community-interactions-content"
        >
          <div className={styles.actions}>
            <p>{t('likes', { count: data.like_count })}</p>
            <Button
              variant="secondary"
              disabled={frozen || editor !== null}
              onClick={() =>
                void run({
                  kind: 'like',
                  input: {
                    operation_id: crypto.randomUUID(),
                    post_id: postId,
                    liked: !data.liked,
                  },
                })
              }
            >
              {t(data.liked ? 'unlike' : 'like')}
            </Button>
          </div>
          <h3>{t('comments', { count: data.comment_count })}</h3>
          {data.comments.length === 0 ? (
            <p>{t('empty')}</p>
          ) : (
            <ol className={styles.list} aria-label={t('commentList')}>
              {data.comments.map((comment) => (
                <li
                  key={comment.id}
                  className={styles.comment}
                  data-community-comment-id={comment.id}
                >
                  <p>
                    {t('author', {
                      name: comment.author.call_name ?? t('anonymousAuthor'),
                    })}
                  </p>
                  <p>
                    {t('createdAt', {
                      date: format.dateTime(new Date(comment.created_at), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })}
                  </p>
                  <p className={styles.body}>{comment.body}</p>
                  {comment.is_owner && (
                    <div className={styles.actions}>
                      <Button
                        variant="secondary"
                        disabled={frozen || editor !== null}
                        onClick={() => {
                          setEditor({ comment, body: comment.body });
                          setInvalidBody(false);
                          setSaved(null);
                        }}
                      >
                        {t('edit')}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={frozen || editor !== null}
                        onClick={() => void remove(comment)}
                      >
                        {t('delete')}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          <nav className={styles.actions} aria-label={t('commentPages')}>
            {pageCursor && (
              <Button
                variant="secondary"
                disabled={frozen}
                onClick={() => page(null)}
              >
                {t('firstPage')}
              </Button>
            )}
            {data.next_cursor ? (
              <Button
                variant="secondary"
                disabled={frozen}
                onClick={() => page(data.next_cursor)}
              >
                {t('nextPage')}
              </Button>
            ) : (
              data.comments.length > 0 && <p>{t('end')}</p>
            )}
          </nav>
          {editor && (
            <form
              className={styles.editor}
              data-testid="community-comment-editor"
              onSubmit={(event) => {
                event.preventDefault();
                update();
              }}
            >
              <h3>{t('editTitle')}</h3>
              <Textarea
                label={t('editBodyLabel')}
                value={editor.body}
                disabled={frozen}
                hint={t('bodyHint', { max: data.policy.max_comment_length })}
                error={invalidBody ? t('invalidBody') : undefined}
                onChange={(event) => {
                  setEditor({ ...editor, body: event.target.value });
                  setInvalidBody(false);
                }}
              />
              <div className={styles.actions}>
                <Button type="submit" disabled={frozen}>
                  {t('save')}
                </Button>
                <Button
                  variant="secondary"
                  disabled={frozen}
                  onClick={() => {
                    setEditor(null);
                    setInvalidBody(false);
                  }}
                >
                  {t('cancelEdit')}
                </Button>
              </div>
            </form>
          )}
          <form
            className={styles.editor}
            data-testid="community-comment-create"
            onSubmit={(event) => {
              event.preventDefault();
              create();
            }}
          >
            <h3>{t('createTitle')}</h3>
            <Textarea
              label={t('bodyLabel')}
              value={body}
              disabled={frozen || editor !== null}
              hint={t('bodyHint', { max: data.policy.max_comment_length })}
              error={invalidBody && !editor ? t('invalidBody') : undefined}
              onChange={(event) => {
                setBody(event.target.value);
                setInvalidBody(false);
              }}
            />
            <Button type="submit" disabled={frozen || editor !== null}>
              {t('create')}
            </Button>
          </form>
        </div>
      )}
    </section>
  );
}
