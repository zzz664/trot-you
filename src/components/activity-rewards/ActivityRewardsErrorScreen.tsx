'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { PointsError } from '@/config/attendance-points';
import { routes } from '@/config/routes';
import { InlineError } from '@/components/ui/InlineError';
export function ActivityRewardsErrorScreen({ code }: { code: PointsError }) {
  const t = useTranslations('activityRewards');
  const router = useRouter();
  return (
    <main className="app-shell">
      <h1>{t('title')}</h1>
      <InlineError
        message={t(`errors.${code}`)}
        onRetry={() => router.refresh()}
      />
      <Link
        href={routes.points}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {t('backPoints')}
      </Link>
    </main>
  );
}
