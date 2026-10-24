'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AuthForm } from '@/components/auth/AuthForm';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { ArtistCatalogData } from '@/config/artists';
import { artistCatalogPath, artistPreviewPath, routes } from '@/config/routes';
import { ArtistSelectionFeedback } from './ArtistSelectionFeedback';
import { useArtistSelection } from './useArtistSelection';

export function ArtistCatalog({ data }: { data: ArtistCatalogData }) {
  const t = useTranslations('artists');
  const onboardingCopy = useTranslations('onboarding');
  const router = useRouter();
  const selection = useArtistSelection();
  return (
    <main
      className="app-shell artist-shell"
      aria-busy={selection.busy || undefined}
    >
      <nav aria-label={t('navigation')}>
        <BackButton
          fallbackHref={
            data.onboarding ? routes.onboardingConsent : routes.start
          }
        />
      </nav>
      <header className="artist-stack">
        {data.onboarding && (
          <p className="ui-hint">{t('onboardingProgress')}</p>
        )}
        <h1>{t(data.onboarding ? 'onboardingTitle' : 'catalogTitle')}</h1>
        <p>
          {t(data.onboarding ? 'onboardingDescription' : 'catalogDescription')}
        </p>
        <p className="ui-hint">{t('interestNotice')}</p>
        {data.selectedName && (
          <p className="artist-selected">
            {t('selectedSummary', { name: data.selectedName })}
          </p>
        )}
      </header>
      <ArtistSelectionFeedback
        error={selection.error}
        saving={selection.saving}
        retry={selection.retry}
      />
      {data.artists.length === 0 ? (
        <Card title={t('emptyTitle')}>
          <p>{t('emptyDescription')}</p>
          <Button variant="secondary" onClick={() => router.refresh()}>
            {t('refreshCatalog')}
          </Button>
        </Card>
      ) : (
        <ul className="artist-list">
          {data.artists.map((artist) => (
            <li key={artist.slug}>
              <Card title={artist.name}>
                <p className="artist-copy">
                  {artist.description ?? t('noIntroduction')}
                </p>
                {data.selectedSlug === artist.slug && (
                  <p className="artist-selected">{t('selected')}</p>
                )}
                <div className="artist-stack">
                  <Button
                    variant="secondary"
                    disabled={selection.busy}
                    onClick={() => router.push(artistPreviewPath(artist.slug))}
                  >
                    {t('previewAction', { name: artist.name })}
                  </Button>
                  {data.onboarding && (
                    <Button
                      disabled={selection.busy}
                      onClick={() => void selection.select(artist)}
                    >
                      {t(
                        data.selectedSlug === artist.slug
                          ? 'selectAgainAction'
                          : 'selectAction',
                        { name: artist.name },
                      )}
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <nav className="artist-pagination" aria-label={t('pageLabel')}>
        <p aria-current="page">{t('pageNumber', { page: data.page })}</p>
        <div className="ui-actions">
          <Button
            variant="secondary"
            disabled={data.page <= 1 || selection.busy}
            onClick={() =>
              router.push(artistCatalogPath(data.page - 1, data.onboarding))
            }
          >
            {t('previousPage')}
          </Button>
          <Button
            variant="secondary"
            disabled={!data.hasNext || selection.busy}
            onClick={() =>
              router.push(artistCatalogPath(data.page + 1, data.onboarding))
            }
          >
            {t('nextPage')}
          </Button>
        </div>
      </nav>
      {data.onboarding && (
        <footer className="artist-stack">
          <p className="ui-hint">{onboardingCopy('resumeHint')}</p>
          <AuthForm
            action={routes.authLogout}
            label={onboardingCopy('cancel')}
            pendingLabel={onboardingCopy('cancelPending')}
            disabled={selection.busy}
          />
        </footer>
      )}
    </main>
  );
}
