'use client';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { FileInput } from '@/components/ui/FileInput';
import { COMMUNITY_MEDIA } from '@/config/community-media';
import type { CommunityPolicy } from '@/config/community-posts';
import { useCommunityImages } from './useCommunityImages';
import styles from './community-posts.module.css';
export type CommunityImagesHandle = { cancelAll: () => Promise<boolean> };
export function CommunityImagesEditor({
  ref,
  artistId,
  postId,
  actorKey,
  policy,
  disabled,
  onChange,
  onAccessLost,
}: {
  ref?: Ref<CommunityImagesHandle>;
  artistId: string;
  postId: string;
  actorKey: string;
  policy: CommunityPolicy;
  disabled: boolean;
  onChange: (ids: string[], pending: boolean) => void;
  onAccessLost: () => void;
}) {
  const t = useTranslations('communityPosts');
  const state = useCommunityImages({
    artistId,
    postId,
    actorKey,
    policy,
    onAccessLost,
  });
  useImperativeHandle(ref, () => ({ cancelAll: state.cancelAll }));
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  }, [onChange]);
  useEffect(() => {
    callback.current(
      state.items.map((item) => item.uploadId),
      state.hasPending || state.phase === 'working',
    );
  }, [state.items, state.hasPending, state.phase]);
  return (
    <section className={styles.stack} aria-label={t('images')}>
      <h2>{t('images')}</h2>
      <p>{t('imageCount', { count: state.items.length })}</p>
      {policy.max_images > 0 ? (
        <FileInput
          label={t('imageLabel')}
          accept={COMMUNITY_MEDIA.accept}
          disabled={
            disabled ||
            state.phase !== null ||
            state.items.length >= policy.max_images
          }
          hint={t('imageHint', {
            max: policy.max_images,
            bytes: policy.max_image_bytes,
          })}
          onFile={state.select}
        />
      ) : (
        <p>{t('imagesDisabled')}</p>
      )}
      {state.error && <p role="alert">{t(`errors.${state.error}`)}</p>}
      {state.phase && (
        <>
          <p role="status">
            {t(
              state.phase === 'ready'
                ? 'uploadReady'
                : state.phase === 'working'
                  ? 'uploading'
                  : 'uploadUncertain',
            )}
          </p>
          <div className={styles.actions}>
            {state.phase !== 'working' && (
              <Button
                disabled={disabled}
                onClick={() =>
                  void (state.recoverRemoval ? state.remove() : state.upload())
                }
              >
                {t(state.phase === 'ready' ? 'upload' : 'uploadRetry')}
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={disabled || state.phase === 'working'}
              onClick={() => void state.remove()}
            >
              {t('uploadCancel')}
            </Button>
          </div>
        </>
      )}
      <ol className={styles.images}>
        {state.items.map((item, index) => (
          <li key={item.uploadId}>
            <p>{t('imageSelected', { number: index + 1 })}</p>
            <p className="ui-hint">{t('uploadVerified')}</p>
            <Button
              variant="secondary"
              disabled={disabled || state.phase !== null}
              onClick={() => void state.remove(item.uploadId)}
            >
              {t('imageRemove', { number: index + 1 })}
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}
