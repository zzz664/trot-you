'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { InlineError } from '@/components/ui/InlineError';
import { routes } from '@/config/routes';
import type { WebPushError } from '@/config/webpush';

export function WebPushErrorScreen({ code }: { code: WebPushError }) {
  const t = useTranslations('notifications');
  const router = useRouter();
  return (
    <main className="app-shell">
      <h1>{t('title')}</h1>
      <InlineError
        message={t(`errors.${code}`)}
        onRetry={() => router.refresh()}
      />
      <Link
        href={routes.home}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {t('back')}
      </Link>
    </main>
  );
}
