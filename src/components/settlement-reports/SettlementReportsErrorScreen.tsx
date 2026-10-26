'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type {
  SettlementReportError,
  SettlementReportMode,
} from '@/config/settlement-reports';
import { routes } from '@/config/routes';
import { InlineError } from '@/components/ui/InlineError';
export function SettlementReportsErrorScreen({
  code,
  mode,
}: {
  code: SettlementReportError;
  mode: SettlementReportMode;
}) {
  const t = useTranslations('settlementReports');
  const router = useRouter();
  return (
    <main className="app-shell">
      <h1>{t(mode === 'artist' ? 'artistTitle' : 'title')}</h1>
      <InlineError
        message={t(`errors.${code}`)}
        onRetry={() => router.refresh()}
      />
      <Link
        href={mode === 'artist' ? routes.artist : routes.admin}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {t('back')}
      </Link>
    </main>
  );
}
