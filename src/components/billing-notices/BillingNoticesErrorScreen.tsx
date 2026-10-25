'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { InlineError } from '@/components/ui/InlineError';
import { routes } from '@/config/routes';
import type { BillingNoticeError } from '@/config/billing-notices';

export function BillingNoticesErrorScreen({
  code,
  onRetry,
}: {
  code: BillingNoticeError;
  onRetry?: () => void;
}) {
  const t = useTranslations('billingNotices');
  const router = useRouter();
  return (
    <main className="app-shell onboarding-shell">
      <h1>{t('title')}</h1>
      <InlineError
        message={t(`errors.${code}`)}
        onRetry={onRetry ?? (() => router.refresh())}
      />
      {code === 'INVALID_INPUT' && (
        <Link
          href={routes.billingNotices}
          prefetch={false}
          className="ui-button ui-button--secondary"
        >
          {t('first')}
        </Link>
      )}
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
        href={routes.subscriptions}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {t('back')}
      </Link>
    </main>
  );
}
