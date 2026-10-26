'use client';

import { useEffect, useRef } from 'react';
import { recordPreviewRender } from '@/client/analytics';
import { ANALYTICS_PREVIEW_SOURCE_ATTRIBUTE } from '@/config/analytics';
import type { ArtistPreviewData } from '@/config/artists';

// Only a committed, visible preview component reports an observation. Rendering
// an RSC payload, route prefetching or merely fetching media cannot invoke it.
export function usePreviewObservations(data: ArtistPreviewData) {
  const element = useRef<HTMLElement>(null);
  const sourcesKey = data.messages.map((message) => message.id).join(',');
  const onboarding = data.onboarding;
  const actorId = data.observationActorId;
  const identity = `${actorId}:${data.artist.slug}:${onboarding}:${sourcesKey}`;
  const attempts = useRef({ identity, sources: new Set<string>() });
  useEffect(() => {
    const root = element.current;
    if (
      onboarding ||
      !actorId ||
      !root ||
      typeof IntersectionObserver === 'undefined' ||
      document.visibilityState !== 'visible'
    )
      return;
    if (attempts.current.identity !== identity)
      attempts.current = { identity, sources: new Set() };
    const sources = attempts.current.sources;
    const allowed = new Set(sourcesKey.split(',').filter(Boolean));
    const controllers = new Set<AbortController>();
    let active = true;
    const stop = () => {
      active = false;
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      observer.disconnect();
    };
    const observer = new IntersectionObserver((entries) => {
      if (!active || document.visibilityState !== 'visible') return;
      for (const entry of entries) {
        const source = entry.target.getAttribute(
          ANALYTICS_PREVIEW_SOURCE_ATTRIBUTE,
        );
        if (
          !entry.isIntersecting ||
          !entry.target.isConnected ||
          !root.contains(entry.target) ||
          !source ||
          !allowed.has(source) ||
          sources.has(source)
        )
          continue;
        // Mark the lifecycle before dispatch. Strict-mode setup replay, repeated
        // intersections and uncertain responses must not generate a new key.
        sources.add(source);
        let eventKey: string;
        try {
          eventKey = crypto.randomUUID();
        } catch {
          continue;
        }
        const controller = new AbortController();
        controllers.add(controller);
        void recordPreviewRender(source, eventKey, actorId, controller.signal)
          .catch(() => undefined)
          .finally(() => controllers.delete(controller));
      }
    });
    root
      .querySelectorAll(`[${ANALYTICS_PREVIEW_SOURCE_ATTRIBUTE}]`)
      .forEach((target) => observer.observe(target));
    const visibility = () => {
      if (document.visibilityState !== 'visible') stop();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', stop);
    window.addEventListener('popstate', stop);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', stop);
      window.removeEventListener('popstate', stop);
    };
    // Identity includes the entire target list. Unrelated rendering cannot retry.
  }, [identity, onboarding, sourcesKey, actorId]);
  return element;
}
