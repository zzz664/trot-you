'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AuthForm } from '@/components/auth/AuthForm';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { ArtistInterest } from '@/config/artists';
import { routes } from '@/config/routes';

export function ArtistInstallPending({ data }: { data: ArtistInterest }) {
  const t = useTranslations('artists');
  const onboardingCopy = useTranslations('onboarding');
  const router = useRouter();
  return (
    <main className="app-shell artist-shell">
      <nav aria-label={t('navigation')}>
        <BackButton fallbackHref={routes.onboardingArtists} />
      </nav>
      <h1>{t('installTitle')}</h1>
      {data.selectedName && (
        <p className="artist-selected">
          {t('selectedSummary', { name: data.selectedName })}
        </p>
      )}
      <p>{t('interestNotice')}</p>
      <Card title={t('installPendingTitle')}>
        <p>{t('installPendingDescription')}</p>
      </Card>
      <Button
        variant="secondary"
        onClick={() => router.push(routes.onboardingArtists)}
      >
        {t('changeSelection')}
      </Button>
      <p className="ui-hint">{onboardingCopy('resumeHint')}</p>
      <AuthForm
        action={routes.authLogout}
        label={onboardingCopy('cancel')}
        pendingLabel={onboardingCopy('cancelPending')}
      />
    </main>
  );
}
