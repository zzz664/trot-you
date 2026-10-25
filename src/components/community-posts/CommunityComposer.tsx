'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  fetchCommunityPosts,
  createCommunityPost,
} from '@/client/community-posts';
import { communityBoardPath, communityPostPath } from '@/config/routes';
import {
  communityCreateSchema,
  type CommunityCreateInput,
  type CommunityList,
} from '@/config/community-posts';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Checkbox } from '@/components/ui/Checkbox';
import { Loading } from '@/components/ui/Loading';
import { InlineError } from '@/components/ui/InlineError';
import {
  CommunityImagesEditor,
  type CommunityImagesHandle,
} from './CommunityImagesEditor';
import { useCommunityResource } from './useCommunityResource';
import styles from './community-posts.module.css';
export function CommunityComposer({
  slug,
  actorKey,
  path,
}: {
  slug: string;
  actorKey: string;
  path: string;
}) {
  const t = useTranslations('communityPosts');
  const router = useRouter();
  const [postId] = useState(() => crypto.randomUUID());
  const [context, setContext] = useState<CommunityList | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [notice, setNotice] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [uploads, setUploads] = useState<string[]>([]);
  const [imagePending, setImagePending] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<CommunityCreateInput | null>(null);
  const images = useRef<CommunityImagesHandle | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [cancelUncertain, setCancelUncertain] = useState(false);
  const cancelRunning = useRef(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const running = useRef(false);
  const erase = useCallback(() => {
    pending.current = null;
    setContext(null);
    setTitle('');
    setBody('');
    setNotice(false);
    setPinned(false);
    setUploads([]);
    setImagePending(false);
    setUncertain(false);
    setCancelUncertain(false);
  }, []);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const result = await fetchCommunityPosts(
        { slug, cursor: null },
        signal,
        actorKey,
      );
      if (!signal.aborted) {
        if (result.ok) setContext(result.data);
        else if (
          result.code === 'FORBIDDEN' ||
          result.code === 'UNAUTHENTICATED' ||
          result.code === 'NOT_FOUND' ||
          result.code === 'SETUP_NOT_READY'
        )
          erase();
      }
      return result;
    },
    [slug, actorKey, erase],
  );
  const state = useCommunityResource(path, load);
  async function save() {
    if (
      running.current ||
      cancelRunning.current ||
      cancelUncertain ||
      state.busy ||
      imagePending ||
      !state.data ||
      !context
    )
      return;
    running.current = true;
    try {
      if (!pending.current) {
        const parsed = communityCreateSchema.safeParse({
          operation_id: crypto.randomUUID(),
          post_id: postId,
          artist_id: context.artist.id,
          title,
          body,
          upload_ids: uploads,
          is_notice: notice,
          is_pinned: pinned,
        });
        if (
          !parsed.success ||
          Array.from(title).length > context.policy.max_title_length ||
          Array.from(body).length > context.policy.max_body_length ||
          uploads.length > context.policy.max_images
        ) {
          setInvalid(true);
          return;
        }
        pending.current = parsed.data;
      }
      setInvalid(false);
      const result = await state.execute((signal) =>
        createCommunityPost(slug, pending.current!, signal, actorKey),
      );
      if (!result || (!result.ok && result.code === 'UNAVAILABLE')) {
        setUncertain(true);
        return;
      }
      if (result.ok) {
        const id = result.data.id;
        erase();
        state.clear();
        router.replace(communityPostPath(slug, id));
      } else {
        pending.current = null;
        setUncertain(false);
        if (
          result.code === 'FORBIDDEN' ||
          result.code === 'UNAUTHENTICATED' ||
          result.code === 'NOT_FOUND' ||
          result.code === 'SETUP_NOT_READY'
        )
          erase();
      }
    } finally {
      running.current = false;
    }
  }
  async function cancel() {
    if (
      cancelRunning.current ||
      running.current ||
      state.busy ||
      pending.current
    )
      return;
    cancelRunning.current = true;
    setCanceling(true);
    setCancelUncertain(false);
    try {
      const cleared = images.current ? await images.current.cancelAll() : true;
      if (!alive.current) return;
      if (!cleared) {
        setCancelUncertain(true);
        return;
      }
      erase();
      state.clear();
      router.replace(communityBoardPath(slug));
    } catch {
      if (alive.current) setCancelUncertain(true);
    } finally {
      cancelRunning.current = false;
      if (alive.current) setCanceling(false);
    }
  }
  const locked =
    state.busy || uncertain || canceling || cancelUncertain || !state.data;
  return (
    <main
      className={`app-shell ${styles.screen}`}
      aria-busy={state.busy || canceling}
    >
      <Button
        variant="secondary"
        disabled={state.busy || canceling || uncertain}
        onClick={() => void cancel()}
      >
        {t('backBoard')}
      </Button>
      <h1>{t('createTitle')}</h1>
      <p>{t('createHint')}</p>
      {canceling && <Loading label={t('cancelingDraft')} />}
      {cancelUncertain && (
        <section
          className={styles.notice}
          data-testid="community-draft-cancel-recovery"
        >
          <p role="alert">{t('cancelUncertain')}</p>
          <Button
            disabled={canceling || state.busy}
            onClick={() => void cancel()}
          >
            {t('cancelRetry')}
          </Button>
        </section>
      )}
      {state.busy && <Loading label={t('loading')} />}{' '}
      {state.error && (
        <InlineError
          message={t(`errors.${state.error}`)}
          onRetry={state.refresh}
        />
      )}
      {context && (
        <div hidden={!state.data}>
          <h2>{context.artist.name}</h2>
          <form
            className={styles.editor}
            data-testid="community-post-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <fieldset className={styles.fields} disabled={locked}>
              <Input
                label={t('titleLabel')}
                value={title}
                required
                autoComplete="off"
                hint={t('titleHint', { max: context.policy.max_title_length })}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setInvalid(false);
                }}
              />
              <Textarea
                label={t('bodyLabel')}
                value={body}
                hint={t('bodyHint', { max: context.policy.max_body_length })}
                onChange={(event) => {
                  setBody(event.target.value);
                  setInvalid(false);
                }}
              />
              {context.can_create_notice && (
                <>
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
                  <p className="ui-hint">{t('noticeAdminHint')}</p>
                </>
              )}
            </fieldset>
            <CommunityImagesEditor
              ref={images}
              artistId={context.artist.id}
              postId={postId}
              actorKey={actorKey}
              policy={context.policy}
              disabled={locked}
              onChange={(ids, busy) => {
                setUploads(ids);
                setImagePending(busy);
              }}
              onAccessLost={() => {
                erase();
                state.clear();
              }}
            />
            {invalid && <p role="alert">{t('errors.INVALID_INPUT')}</p>}
            {uncertain && <p role="alert">{t('uncertain')}</p>}
            <div className={styles.actions}>
              <Button
                type="submit"
                disabled={
                  state.busy ||
                  imagePending ||
                  canceling ||
                  cancelUncertain ||
                  !state.data
                }
              >
                {t(uncertain ? 'retryOperation' : 'createSave')}
              </Button>
              <Button
                variant="secondary"
                disabled={state.busy || canceling || uncertain}
                onClick={() => void cancel()}
              >
                {t('cancel')}
              </Button>
              {uncertain && (
                <Link
                  href={communityPostPath(slug, postId)}
                  prefetch={false}
                  onNavigate={state.clear}
                  className="ui-button ui-button--secondary"
                >
                  {t('checkCreated')}
                </Link>
              )}
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
