'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { InlineError } from '@/components/ui/InlineError';
import { routes } from '@/config/routes';
import type { AdminArtistError } from '@/config/admin-artists';

export function AdminArtistsErrorScreen({
  code,
  onRetry,
  access = false,
}: {
  code: AdminArtistError;
  onRetry?: () => void;
  access?: boolean;
}) {
  const t = useTranslations('adminArtists');
  const router = useRouter();
  return (
    <main className="app-shell onboarding-shell">
      <h1>{t(access ? 'accessTitle' : 'title')}</h1>
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
      {!access && (
        <Link
          href={routes.adminArtists}
          prefetch={false}
          className="ui-button ui-button--secondary"
        >
          {t('first')}
        </Link>
      )}
      <Link
        href={access ? routes.home : routes.admin}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {t(access ? 'backHome' : 'back')}
      </Link>
    </main>
  );
}
