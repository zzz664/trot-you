'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { InlineError } from '@/components/ui/InlineError';
import { Loading } from '@/components/ui/Loading';
import type { ArtistError } from '@/config/artists';
import { routes } from '@/config/routes';

export function ArtistSelectionFeedback({
  error,
  saving,
  retry,
}: {
  error: ArtistError | null;
  saving: boolean;
  retry: () => void | Promise<void>;
}) {
  const t = useTranslations('artists');
  const onboardingCopy = useTranslations('onboarding');
  const router = useRouter();
  return (
    <>
      {saving && <Loading label={t('selectionSaving')} />}
      {error && (
        <InlineError
          message={t(
            error === 'UNAVAILABLE' ? 'selectionUncertain' : `errors.${error}`,
          )}
          onRetry={retry}
        />
      )}
      {error === 'UNAUTHENTICATED' && (
        <Button onClick={() => router.push(routes.start)}>
          {t('loginAction')}
        </Button>
      )}
      {error === 'PROFILE_REQUIRED' && (
        <Button onClick={() => router.push(routes.onboarding)}>
          {onboardingCopy('resume')}
        </Button>
      )}
    </>
  );
}
