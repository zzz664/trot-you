'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { mediaExpiryDelay, readMediaUrl } from '@/client/media';
import { Button } from '@/components/ui/Button';
import type { MediaError, MediaKind, MediaReadGrant } from '@/config/media';

type SecureMediaProps = {
  mediaId: string;
  kind: MediaKind;
  preview: boolean;
};
type PlaybackIntent = { position: number; play: boolean };

// Identity changes remount the owner, including query-only navigation.
export function SecureMedia(props: SecureMediaProps) {
  return (
    <MediaResource
      key={`${props.mediaId}:${props.kind}:${props.preview}`}
      {...props}
    />
  );
}

function clearSources(elements: Element[]) {
  for (const element of elements) {
    if (!element.hasAttribute('src')) continue;
    element.removeAttribute('src');
    if (element instanceof HTMLMediaElement) {
      element.pause();
      element.load();
    }
  }
}

function MediaResource({ mediaId, kind, preview }: SecureMediaProps) {
  const t = useTranslations('media');
  const artistCopy = useTranslations('artists');
  const [grant, setGrant] = useState<
    (MediaReadGrant & { generation: number; continuation: boolean }) | null
  >(null);
  const [error, setError] = useState<MediaError | null>(null);
  const [loading, setLoading] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [notice, setNotice] = useState<
    | 'expired'
    | 'hidden'
    | 'resumeReady'
    | 'continuationPaused'
    | 'resumeUnavailable'
    | null
  >(null);
  const active = useRef(true);
  const working = useRef(false);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const container = useRef<HTMLElement | null>(null);
  const resume = useRef<PlaybackIntent | null>(null);
  const kindLabel = artistCopy(`messageKinds.${kind}`);

  const open = useCallback(
    async (intent: PlaybackIntent | null = null) => {
      if (working.current) return;
      working.current = true;
      const owner = ++generation.current;
      request.current = new AbortController();
      resume.current = intent;
      setContinuing(intent?.play ?? false);
      setLoading(true);
      setError(null);
      setNotice(null);
      setGrant(null);
      try {
        const result = await readMediaUrl(
          { mediaId, preview },
          request.current.signal,
        );
        if (!active.current || owner !== generation.current) return;
        if (!result.ok) {
          resume.current = null;
          setContinuing(false);
          setError(result.code);
        } else if (result.data.kind !== kind) {
          resume.current = null;
          setContinuing(false);
          setError('UNAVAILABLE');
        } else
          setGrant({
            ...result.data,
            generation: owner,
            continuation: intent !== null,
          });
      } catch {
        if (active.current && owner === generation.current) {
          resume.current = null;
          setContinuing(false);
          setError('UNAVAILABLE');
        }
      } finally {
        if (active.current && owner === generation.current) {
          working.current = false;
          setLoading(false);
        }
      }
    },
    [kind, mediaId, preview],
  );

  useEffect(() => {
    active.current = true;
    function leave() {
      generation.current += 1;
      request.current?.abort();
      working.current = false;
      resume.current = null;
      // pagehide can precede a back/forward-cache snapshot. Clear source URLs
      // synchronously, not just after React commits; never persist capabilities.
      clearSources(
        Array.from(container.current?.querySelectorAll('[src]') ?? []),
      );
      setGrant(null);
      setLoading(false);
      setContinuing(false);
      setNotice('hidden');
      setError(null);
    }
    window.addEventListener('pagehide', leave);
    return () => {
      active.current = false;
      generation.current += 1;
      request.current?.abort();
      resume.current = null;
      window.removeEventListener('pagehide', leave);
    };
  }, []);

  useEffect(() => {
    if (!grant) return;
    // Keep element references: React can detach children before passive cleanup.
    // Detachment alone need not stop native audio playback.
    const elements = Array.from(
      container.current?.querySelectorAll('[src]') ?? [],
    );
    const timer = window.setTimeout(() => {
      const player = elements.find(
        (element) => element instanceof HTMLMediaElement,
      );
      if (
        player instanceof HTMLMediaElement &&
        !player.paused &&
        !player.ended &&
        Number.isFinite(player.currentTime)
      ) {
        // Clips can be longer than a URL's lifetime. Reauthorize only active
        // user-started playback; stop/unload the old capability before awaiting
        // the new one. This refresh never extends a grant after access denial.
        const intent = {
          position: Math.max(0, player.currentTime),
          play: true,
        };
        clearSources(elements);
        void open(intent);
      } else {
        // A paused clip remains paused. Keep only its local position so an
        // explicit retry need not restart a long recording from the beginning.
        resume.current =
          player instanceof HTMLMediaElement &&
          !player.ended &&
          Number.isFinite(player.currentTime)
            ? { position: Math.max(0, player.currentTime), play: false }
            : null;
        setGrant(null);
        setNotice('expired');
      }
    }, mediaExpiryDelay(grant.expiresAt));
    return () => {
      window.clearTimeout(timer);
      clearSources(elements);
    };
  }, [grant, open]);

  function restorePlayback(element: HTMLMediaElement) {
    const intent = resume.current;
    if (!intent) return;
    resume.current = null;
    setContinuing(false);
    const owner = generation.current;
    try {
      element.currentTime = Number.isFinite(element.duration)
        ? Math.min(intent.position, Math.max(0, element.duration))
        : intent.position;
    } catch {
      setNotice('resumeUnavailable');
      return;
    }
    if (!intent.play) setNotice('resumeReady');
    if (intent.play) {
      void element.play().catch(() => {
        if (active.current && owner === generation.current)
          setNotice('resumeReady');
      });
    }
  }

  function pauseContinuation() {
    if (resume.current) resume.current.play = false;
    setContinuing(false);
    setNotice('continuationPaused');
  }

  function playbackError() {
    resume.current = null;
    setContinuing(false);
    setGrant(null);
    setError('UNAVAILABLE');
  }

  return (
    <figure
      className="secure-media"
      ref={container}
      aria-busy={loading || undefined}
    >
      {loading && <p role="status">{t('loading')}</p>}
      {error && <p role="alert">{t(`errors.${error}`)}</p>}
      {notice && <p role="status">{t(notice)}</p>}
      {continuing && (
        <Button variant="secondary" onClick={pauseContinuation}>
          {t('pauseContinuation')}
        </Button>
      )}
      {!grant && (
        <Button
          isLoading={loading}
          onClick={() =>
            void open(
              resume.current ? { ...resume.current, play: false } : null,
            )
          }
        >
          {t(error || notice ? 'retry' : 'open', { kind: kindLabel })}
        </Button>
      )}
      {grant?.kind === 'photo' && (
        <div className="secure-media-photo">
          <Image
            key={grant.generation}
            src={grant.url}
            alt={t('photoAlt')}
            fill
            unoptimized
            loading="lazy"
            referrerPolicy="no-referrer"
            crossOrigin="anonymous"
            onError={playbackError}
          />
        </div>
      )}
      {grant?.kind === 'voice' && (
        <audio
          key={grant.generation}
          src={grant.url}
          controls
          crossOrigin="anonymous"
          preload={grant.continuation ? 'metadata' : 'none'}
          aria-label={t('voiceLabel')}
          onError={playbackError}
          onLoadedMetadata={(event) => restorePlayback(event.currentTarget)}
        >
          {t('playbackFallback')}
        </audio>
      )}
      {grant?.kind === 'video' && (
        <video
          key={grant.generation}
          src={grant.url}
          controls
          playsInline
          crossOrigin="anonymous"
          preload={grant.continuation ? 'metadata' : 'none'}
          aria-label={t('videoLabel')}
          onError={playbackError}
          onLoadedMetadata={(event) => restorePlayback(event.currentTarget)}
        >
          {t('playbackFallback')}
        </video>
      )}
    </figure>
  );
}
