'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { InlineError } from '@/components/ui/InlineError';
import { AuthForm } from '@/components/auth/AuthForm';
import { routes } from '@/config/routes';
import type { OnboardingError } from '@/config/onboarding';

export function OnboardingEntry({
  next,
  error,
}: {
  next?: string;
  error?: OnboardingError;
}) {
  const router = useRouter();
  const t = useTranslations('onboarding');
  return (
    <main className="app-shell onboarding-shell">
      <h1>{t('overviewTitle')}</h1>
      <p>{t('overviewDescription')}</p>
      {error ? (
        <InlineError
          message={t(`errors.${error}`)}
          onRetry={() => router.refresh()}
        />
      ) : (
        <Button onClick={() => next && router.push(next)}>{t('resume')}</Button>
      )}
      <p className="ui-hint">{t('resumeHint')}</p>
      <AuthForm
        action={routes.authLogout}
        label={t('cancel')}
        pendingLabel={t('cancelPending')}
      />
    </main>
  );
}
