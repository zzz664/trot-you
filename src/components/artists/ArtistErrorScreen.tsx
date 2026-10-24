'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { InlineError } from '@/components/ui/InlineError';
import type { ArtistError } from '@/config/artists';
import { routes } from '@/config/routes';

export function ArtistErrorScreen({
  code,
  onboarding = false,
  onRetry,
}: {
  code: ArtistError;
  onboarding?: boolean;
  onRetry?: () => void;
}) {
  const t = useTranslations('artists');
  const onboardingCopy = useTranslations('onboarding');
  const router = useRouter();
  return (
    <main className="app-shell artist-shell">
      <nav aria-label={t('navigation')}>
        <BackButton
          fallbackHref={onboarding ? routes.onboarding : routes.artists}
        />
      </nav>
      <h1>{t('errorTitle')}</h1>
      <InlineError
        message={t(`errors.${code}`)}
        onRetry={onRetry ?? (() => router.refresh())}
      />
      {code === 'PROFILE_REQUIRED' && (
        <Button onClick={() => router.push(routes.onboarding)}>
          {onboardingCopy('resume')}
        </Button>
      )}
      {code === 'UNAUTHENTICATED' && (
        <Button onClick={() => router.push(routes.start)}>
          {t('loginAction')}
        </Button>
      )}
      <Button
        variant="secondary"
        onClick={() =>
          router.push(onboarding ? routes.onboardingArtists : routes.artists)
        }
      >
        {t(onboarding ? 'backToSelection' : 'backToCatalog')}
      </Button>
    </main>
  );
}
