'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { InlineError } from '@/components/ui/InlineError';
import type { CheckoutError } from '@/config/checkout';
import { routes } from '@/config/routes';

export function CheckoutErrorScreen({ code }: { code: CheckoutError }) {
  const t = useTranslations('checkout');
  const uiCopy = useTranslations('ui');
  const router = useRouter();
  return (
    <main className="app-shell onboarding-shell">
      <nav aria-label={t('navigation')}>
        <IconButton
          label={uiCopy('back')}
          icon="←"
          variant="secondary"
          onClick={() => router.replace(routes.artists)}
        />
      </nav>
      <h1>{t('errorTitle')}</h1>
      <InlineError
        message={t(`errors.${code}`)}
        onRetry={() => router.refresh()}
      />
      <p>{t('missingPolicyNotice')}</p>
      <Button disabled>{t('completionUnavailable')}</Button>
      <Button
        variant="secondary"
        onClick={() => router.replace(routes.artists)}
      >
        {t('backToArtists')}
      </Button>
    </main>
  );
}
