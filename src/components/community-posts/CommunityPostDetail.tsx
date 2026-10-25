'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import {
  fetchCommunityPost,
  deleteCommunityPost,
  setCommunityNotice,
} from '@/client/community-posts';
import { communityBoardPath } from '@/config/routes';
import type {
  CommunityDeleteInput,
  CommunityNoticeInput,
  CommunityDetail,
} from '@/config/community-posts';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Loading } from '@/components/ui/Loading';
import { InlineError } from '@/components/ui/InlineError';
import { useDialog } from '@/components/ui/DialogProvider';
import { CommunityImage } from './CommunityImage';
import { useCommunityResource } from './useCommunityResource';
import styles from './community-posts.module.css';
export function CommunityPostDetail({
  slug,
  postId,
  actorKey,
  path,
}: {
  slug: string;
  postId: string;
  actorKey: string;
  path: string;
}) {
  const t = useTranslations('communityPosts');
  const format = useFormatter();
  const { showDialog, cancelDialog } = useDialog();
  const [confirming, setConfirming] = useState(false);
  const [uncertain, setUncertain] = useState<'delete' | 'notice' | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [saved, setSaved] = useState(false);
  const pendingDelete = useRef<CommunityDeleteInput | null>(null);
  const pendingNotice = useRef<CommunityNoticeInput | null>(null);
  const running = useRef(false);
  const alive = useRef(false);
  const erase = useCallback(() => {
    pendingDelete.current = null;
    pendingNotice.current = null;
    setUncertain(null);
    setSaved(false);
  }, []);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const result = await fetchCommunityPost(
        { slug, post_id: postId },
        signal,
        actorKey,
      );
      if (
        !signal.aborted &&
        !result.ok &&
        (result.code === 'FORBIDDEN' || result.code === 'UNAUTHENTICATED')
      )
        erase();
      return result;
    },
    [slug, postId, actorKey, erase],
  );
  const state = useCommunityResource(path, load);
  const data = state.data;
  useEffect(() => {
    alive.current = true;
    const invalidate = () => {
      cancelDialog('community-post-delete');
      setConfirming(false);
      if (pendingDelete.current) setUncertain('delete');
      if (pendingNotice.current) setUncertain('notice');
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') invalidate();
    };
    window.addEventListener('pagehide', invalidate);
    window.addEventListener('popstate', invalidate);
    window.addEventListener('focus', invalidate);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive.current = false;
      cancelDialog('community-post-delete');
      window.removeEventListener('pagehide', invalidate);
      window.removeEventListener('popstate', invalidate);
      window.removeEventListener('focus', invalidate);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [cancelDialog]);
  function clear() {
    cancelDialog('community-post-delete');
    erase();
    state.clear();
  }
  async function remove() {
    if (running.current || state.busy || (!pendingDelete.current && !data))
      return;
    running.current = true;
    try {
      if (!pendingDelete.current) {
        setConfirming(true);
        const answer = await showDialog({
          key: 'community-post-delete',
          title: t('deleteDialogTitle'),
          description: t('deleteDialogDescription'),
          confirmLabel: t('deleteDialogConfirm'),
          cancelLabel: t('deleteDialogCancel'),
        });
        if (!alive.current) return;
        setConfirming(false);
        if (answer !== 'confirmed') return;
        pendingDelete.current = {
          operation_id: crypto.randomUUID(),
          post_id: postId,
          expected_revision: data!.post.revision,
          confirmed: true,
        };
      }
      const result = await state.execute((signal) =>
        deleteCommunityPost(slug, pendingDelete.current!, signal, actorKey),
      );
      if (!result || (!result.ok && result.code === 'UNAVAILABLE')) {
        if (alive.current) setUncertain('delete');
        return;
      }
      pendingDelete.current = null;
      setUncertain(null);
      if (result.ok) {
        state.clear();
        setDeleted(true);
      } else if (
        result.code === 'FORBIDDEN' ||
        result.code === 'UNAUTHENTICATED'
      )
        erase();
    } finally {
      running.current = false;
    }
  }
  async function notice(isNotice?: boolean, isPinned?: boolean) {
    if (running.current || state.busy || (!pendingNotice.current && !data))
      return;
    running.current = true;
    try {
      if (!pendingNotice.current)
        pendingNotice.current = {
          operation_id: crypto.randomUUID(),
          post_id: postId,
          expected_revision: data!.post.revision,
          is_notice: isNotice!,
          is_pinned: isPinned!,
        };
      setSaved(false);
      const result = await state.execute((signal) =>
        setCommunityNotice(slug, pendingNotice.current!, signal, actorKey),
      );
      if (!result || (!result.ok && result.code === 'UNAVAILABLE')) {
        if (alive.current) setUncertain('notice');
        return;
      }
      pendingNotice.current = null;
      setUncertain(null);
      if (result.ok) {
        await state.refresh();
        setSaved(true);
      } else if (
        result.code === 'FORBIDDEN' ||
        result.code === 'UNAUTHENTICATED'
      )
        erase();
    } finally {
      running.current = false;
    }
  }
  return (
    <main className={`app-shell ${styles.screen}`} aria-busy={state.busy}>
      <Link
        href={communityBoardPath(slug)}
        prefetch={false}
        onNavigate={clear}
        className="ui-button ui-button--secondary"
      >
        {t('backBoard')}
      </Link>
      <h1>{t('title')}</h1>
      {!deleted && (
        <Button
          variant="secondary"
          disabled={state.busy || confirming}
          onClick={() => {
            setSaved(false);
            void state.refresh();
          }}
        >
          {t('refresh')}
        </Button>
      )}
      {!deleted && state.busy && <Loading label={t('loading')} />}{' '}
      {!deleted && state.error && (
        <InlineError
          message={t(`errors.${state.error}`)}
          onRetry={state.refresh}
        />
      )}
      {deleted && <p role="status">{t('deleted')}</p>}
      {saved && <p role="status">{t('noticeSaved')}</p>}
      {uncertain && (
        <section
          className={styles.notice}
          data-testid="community-post-recovery"
        >
          <p role="alert">{t('uncertain')}</p>
          <Button
            disabled={state.busy || confirming}
            onClick={() => void (uncertain === 'delete' ? remove() : notice())}
          >
            {t('retryOperation')}
          </Button>
        </section>
      )}
      {data && !deleted && (
        <article className={styles.stack} data-testid="community-post-detail">
          <h2>{data.post.title}</h2>
          <div className={styles.badges}>
            {data.post.is_notice && <span>{t('noticeBadge')}</span>}
            {data.post.is_pinned && <span>{t('pinnedBadge')}</span>}
          </div>
          <p>
            {t('author', {
              name: data.post.author.call_name ?? t('anonymousAuthor'),
            })}
          </p>
          <p>
            {t('createdAt', {
              date: format.dateTime(new Date(data.post.created_at), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })}
          </p>
          <p className={styles.body}>{data.post.body}</p>
          <ol className={styles.images}>
            {data.post.images.map((image, index) => (
              <li key={image.id}>
                <CommunityImage
                  image={image}
                  postId={postId}
                  actorKey={actorKey}
                  number={index + 1}
                  onAccessLost={(code) => {
                    erase();
                    state.invalidate(code);
                  }}
                />
              </li>
            ))}
          </ol>
          {data.can_create_notice && (
            <NoticeEditor
              key={`${data.post.id}:${data.post.revision}`}
              data={data}
              disabled={state.busy || confirming || uncertain !== null}
              onSave={notice}
            />
          )}
          {data.post.is_owner &&
            (!data.post.is_notice || data.can_create_notice) && (
              <Button
                variant="secondary"
                disabled={state.busy || confirming || uncertain !== null}
                onClick={() => void remove()}
              >
                {t('deleteAction')}
              </Button>
            )}
        </article>
      )}
    </main>
  );
}
function NoticeEditor({
  data,
  disabled,
  onSave,
}: {
  data: CommunityDetail;
  disabled: boolean;
  onSave: (notice: boolean, pinned: boolean) => Promise<void>;
}) {
  const t = useTranslations('communityPosts');
  const [notice, setNotice] = useState(data.post.is_notice);
  const [pinned, setPinned] = useState(data.post.is_pinned);
  return (
    <form
      className={styles.editor}
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(notice, pinned);
      }}
    >
      <h2>{t('noticeSettings')}</h2>
      <fieldset className={styles.fields} disabled={disabled}>
        <Checkbox
          label={t('noticeLabel')}
          checked={notice}
          onChange={(event) => {
            setNotice(event.target.checked);
            if (!event.target.checked) setPinned(false);
          }}
        />
        <Checkbox
          label={t('pinnedLabel')}
          checked={pinned}
          disabled={!notice}
          onChange={(event) => setPinned(event.target.checked)}
        />
      </fieldset>
      <Button type="submit" disabled={disabled}>
        {t('saveNotice')}
      </Button>
    </form>
  );
}
