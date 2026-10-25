'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { InlineError } from '@/components/ui/InlineError';
import { routes } from '@/config/routes';
import type { AdminSubscriptionError } from '@/config/admin-subscriptions';

export function AdminSubscriptionsErrorScreen({
  code,
  onRetry,
}: {
  code: AdminSubscriptionError;
  onRetry?: () => void;
}) {
  const t = useTranslations('adminSubscriptions');
  const router = useRouter();
  return (
    <main className="app-shell onboarding-shell">
      <h1>{t('title')}</h1>
      <InlineError
        message={t(`errors.${code}`)}
        onRetry={onRetry ?? (() => router.refresh())}
      />
      {code === 'UNAUTHENTICATED' && (
        <Link
          href={routes.start}
          prefetch={false}
          className="ui-button ui-button--primary"
        >
          {t('signIn')}
        </Link>
      )}
      <Link
        href={routes.adminSubscriptions}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {t('reset')}
      </Link>
      <Link
        href={routes.admin}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {t('back')}
      </Link>
    </main>
  );
}
