'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { InlineError } from '@/components/ui/InlineError';
import { routes } from '@/config/routes';
import type { AdminSettingsError } from '@/config/admin-settings';
export function AdminSettingsErrorScreen({
  code,
  onRetry,
}: {
  code: AdminSettingsError;
  onRetry?: () => void;
}) {
  const t = useTranslations('adminSettings');
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
        href={routes.admin}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {t('back')}
      </Link>
    </main>
  );
}
