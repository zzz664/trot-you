'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { AnalyticsFunnelError } from '@/config/analytics-funnel';
import { routes } from '@/config/routes';
import { InlineError } from '@/components/ui/InlineError';
export function AnalyticsFunnelErrorScreen({
  code,
}: {
  code: AnalyticsFunnelError;
}) {
  const t = useTranslations('analyticsFunnel');
  const router = useRouter();
  return (
    <main className="app-shell">
      <h1>{t('title')}</h1>
      <InlineError
        message={t(`errors.${code}`)}
        onRetry={() => router.refresh()}
      />
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
