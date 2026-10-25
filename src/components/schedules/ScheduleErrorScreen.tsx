'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ScheduleError } from '@/config/schedules';
import { routes } from '@/config/routes';
import { InlineError } from '@/components/ui/InlineError';
export function ScheduleErrorScreen({
  code,
  admin = false,
}: {
  code: ScheduleError;
  admin?: boolean;
}) {
  const t = useTranslations('schedules');
  const router = useRouter();
  return (
    <main className="app-shell onboarding-shell">
      <h1>{t(admin ? 'adminTitle' : 'title')}</h1>
      <InlineError
        message={t(`errors.${code}`)}
        onRetry={() => router.refresh()}
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
        href={admin ? routes.admin : routes.home}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {t(admin ? 'backAdmin' : 'back')}
      </Link>
    </main>
  );
}
