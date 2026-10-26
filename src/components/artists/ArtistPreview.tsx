'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SecureMedia } from '@/components/media/SecureMedia';
import { ANALYTICS_PREVIEW_SOURCE_ATTRIBUTE } from '@/config/analytics';
import { usePreviewObservations } from './usePreviewObservations';
import type { ArtistPreviewData } from '@/config/artists';
import { checkoutPath, routes } from '@/config/routes';
import { ArtistSelectionFeedback } from './ArtistSelectionFeedback';
import { useArtistSelection } from './useArtistSelection';

export function ArtistPreview({ data }: { data: ArtistPreviewData }) {
  const t = useTranslations('artists');
  const checkoutCopy = useTranslations('checkout');
  const selection = useArtistSelection();
  const observationElement = usePreviewObservations(data);
  return (
    <main
      ref={observationElement}
      className="app-shell artist-shell"
      aria-busy={selection.busy || undefined}
    >
      <nav aria-label={t('navigation')}>
        <BackButton
          fallbackHref={
            data.onboarding ? routes.onboardingArtists : routes.artists
          }
        />
      </nav>
      <header className="artist-stack">
        <h1>{t('previewTitle', { name: data.artist.name })}</h1>
        <p>{t('previewDescription')}</p>
        <p className="artist-copy">
          {data.artist.description ?? t('noIntroduction')}
        </p>
        <p className="ui-hint">{t('interestNotice')}</p>
        {data.selectedSlug === data.artist.slug && (
          <p className="artist-selected">{t('selected')}</p>
        )}
      </header>
      {data.messages.length === 0 ? (
        <Card title={t('previewEmptyTitle')}>
          <p>{t('previewEmptyDescription')}</p>
        </Card>
      ) : (
        <ol className="artist-message-list">
          {data.messages.map((message) => (
            <li
              key={message.id}
              {...{ [ANALYTICS_PREVIEW_SOURCE_ATTRIBUTE]: message.id }}
            >
              <Card title={t(`messageKinds.${message.kind}`)}>
                {message.text && <p className="artist-copy">{message.text}</p>}
                {message.media.map((media, index) =>
                  media.availability === 'available' ? (
                    <SecureMedia
                      key={media.id}
                      mediaId={media.id}
                      kind={media.kind}
                      preview
                    />
                  ) : (
                    <p className="artist-media-unavailable" key={index}>
                      {t('mediaUnavailable', {
                        kind: t(`messageKinds.${media.kind}`),
                      })}
                    </p>
                  ),
                )}
              </Card>
            </li>
          ))}
        </ol>
      )}
      <ArtistSelectionFeedback
        error={selection.error}
        saving={selection.saving}
        retry={selection.retry}
      />
      {!data.onboarding && (
        <Link
          className="ui-button ui-button--primary"
          href={checkoutPath(data.artist.slug)}
          prefetch={false}
        >
          {checkoutCopy('openTerms')}
        </Link>
      )}
      {data.onboarding && (
        <Button
          disabled={selection.busy}
          onClick={() => void selection.select(data.artist)}
        >
          {t(
            data.selectedSlug === data.artist.slug
              ? 'selectAgainAction'
              : 'selectAction',
            { name: data.artist.name },
          )}
        </Button>
      )}
    </main>
  );
}
