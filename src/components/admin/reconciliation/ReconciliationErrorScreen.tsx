'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BackButton } from '@/components/ui/BackButton';
import { InlineError } from '@/components/ui/InlineError';
import type { ReconciliationAdminError } from '@/config/reconciliation-admin';
import { routes } from '@/config/routes';

export function ReconciliationErrorScreen({
  code,
  onRetry,
}: {
  code: ReconciliationAdminError;
  onRetry?: () => void;
}) {
  const router = useRouter();
  const t = useTranslations('reconciliation');
  return (
    <main className="app-shell onboarding-shell">
      <nav aria-label={t('navigation')}>
        <BackButton fallbackHref={routes.admin} />
      </nav>
      <h1>{t('errorTitle')}</h1>
      <InlineError
        message={t(`errors.${code}`)}
        onRetry={onRetry ?? (() => router.refresh())}
      />
    </main>
  );
}
