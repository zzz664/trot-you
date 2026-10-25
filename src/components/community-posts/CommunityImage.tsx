'use client';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { readCommunityImage } from '@/client/community-media';
import {
  COMMUNITY_MEDIA,
  type CommunityImageReadGrant,
} from '@/config/community-media';
import type {
  CommunityError,
  CommunityImage as ImageMetadata,
} from '@/config/community-posts';
import { Button } from '@/components/ui/Button';
import styles from './community-posts.module.css';
export function CommunityImage({
  image,
  postId,
  actorKey,
  number,
  onAccessLost,
}: {
  image: ImageMetadata;
  postId: string;
  actorKey: string;
  number: number;
  onAccessLost: (code: CommunityError) => void;
}) {
  const t = useTranslations('communityPosts');
  const [grant, setGrant] = useState<CommunityImageReadGrant | null>(null);
  const [error, setError] = useState<CommunityError | null>(null);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const node = useRef<HTMLElement | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const alive = useRef(false);
  const clear = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    node.current?.querySelectorAll('img').forEach((img) => {
      img.removeAttribute('src');
      img.removeAttribute('srcset');
    });
    setGrant(null);
    setBusy(false);
  }, []);
  useEffect(() => {
    alive.current = true;
    const visibility = () => {
      if (document.visibilityState === 'hidden') clear();
    };
    window.addEventListener('pagehide', clear);
    window.addEventListener('popstate', clear);
    window.addEventListener('focus', clear);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive.current = false;
      clear();
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('popstate', clear);
      window.removeEventListener('focus', clear);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [clear]);
  useEffect(() => {
    if (!grant) return;
    const delay = Math.max(
      0,
      Math.min(
        COMMUNITY_MEDIA.readTtlSeconds * COMMUNITY_MEDIA.millisecondsPerSecond,
        Date.parse(grant.expiresAt) - Date.now(),
      ),
    );
    const timer = window.setTimeout(() => {
      clear();
      setExpired(true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [grant, clear]);
  async function open() {
    if (controller.current) return;
    const owner = ++generation.current;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError(null);
    setExpired(false);
    const result = await readCommunityImage(
      { imageId: image.id, postId },
      request.signal,
      actorKey,
    ).catch(() => ({ ok: false as const, code: 'UNAVAILABLE' as const }));
    if (
      !alive.current ||
      owner !== generation.current ||
      request.signal.aborted
    )
      return;
    controller.current = null;
    setBusy(false);
    if (result.ok && result.data.mimeType === image.mime_type)
      setGrant(result.data);
    else {
      const code = result.ok ? 'UNAVAILABLE' : result.code;
      setError(code);
      if (
        code === 'FORBIDDEN' ||
        code === 'UNAUTHENTICATED' ||
        code === 'NOT_FOUND' ||
        code === 'SETUP_NOT_READY'
      )
        onAccessLost(code);
    }
  }
  return (
    <figure className={styles.imageFrame} ref={node} aria-busy={busy}>
      {error && <p role="alert">{t(`errors.${error}`)}</p>}
      {expired && <p role="status">{t('imageExpired')}</p>}
      {busy && <p role="status">{t('imageLoading')}</p>}
      {grant ? (
        <>
          <Image
            src={grant.url}
            alt={t('imageAlt', { number })}
            width={image.width}
            height={image.height}
            unoptimized
            className={styles.image}
            referrerPolicy="no-referrer"
            crossOrigin="anonymous"
            onError={() => {
              clear();
              setError('UNAVAILABLE');
            }}
          />
          <Button variant="secondary" onClick={clear}>
            {t('imageClose')}
          </Button>
        </>
      ) : (
        <Button variant="secondary" disabled={busy} onClick={() => void open()}>
          {t('imageOpen', { number })}
        </Button>
      )}
    </figure>
  );
}
