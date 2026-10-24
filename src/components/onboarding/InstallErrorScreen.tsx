'use client';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { InlineError } from '@/components/ui/InlineError';
import type { InstallError } from '@/config/install';
import { routes } from '@/config/routes';

export function InstallErrorScreen({
  code,
  onRetry,
}: {
  code: InstallError;
  onRetry?: () => void;
}) {
  const t = useTranslations('install');
  const onboardingCopy = useTranslations('onboarding');
  const router = useRouter();
  return (
    <main className="app-shell onboarding-shell">
      <nav aria-label={t('navigation')}>
        <BackButton fallbackHref={routes.onboardingArtists} />
      </nav>
      <h1>{t('title')}</h1>
      <InlineError
        message={t(`errors.${code}`)}
        onRetry={onRetry ?? (() => router.refresh())}
      />
      <Button onClick={() => router.push(routes.onboarding)}>
        {onboardingCopy('resume')}
      </Button>
    </main>
  );
}
