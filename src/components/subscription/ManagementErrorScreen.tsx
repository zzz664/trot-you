'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { InlineError } from '@/components/ui/InlineError';
import { routes } from '@/config/routes';
import type { ManagementError } from '@/config/subscription-management';

export function ManagementErrorScreen({
  code,
  admin = false,
  onRetry,
}: {
  code: ManagementError;
  admin?: boolean;
  onRetry?: () => void;
}) {
  const router = useRouter();
  const t = useTranslations(admin ? 'refunds' : 'subscriptions');
  return (
    <main className="app-shell onboarding-shell">
      <nav aria-label={t('navigation')}>
        <BackButton fallbackHref={admin ? routes.admin : routes.home} />
      </nav>
      <h1>{t('errorTitle')}</h1>
      <InlineError
        message={t(`errors.${code}`)}
        onRetry={onRetry ?? (() => router.refresh())}
      />
      {code === 'UNAUTHENTICATED' && (
        <Button onClick={() => router.replace(routes.start)}>
          {t('signIn')}
        </Button>
      )}
    </main>
  );
}
