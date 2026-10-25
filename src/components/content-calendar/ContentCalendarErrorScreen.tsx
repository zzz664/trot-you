'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { InlineError } from '@/components/ui/InlineError';
import { useTranslations } from 'next-intl';
import { routes } from '@/config/routes';
import type { ContentCalendarError } from '@/config/content-calendar';
export function ContentCalendarErrorScreen({
  code,
  admin = false,
}: {
  code: ContentCalendarError;
  admin?: boolean;
}) {
  const t = useTranslations('contentCalendar');
  const router = useRouter();
  return (
    <main className="app-shell">
      <h1>{t(admin ? 'adminTitle' : 'title')}</h1>
      <InlineError
        message={t(`errors.${code}`)}
        onRetry={() => router.refresh()}
      />
      <Link
        href={admin ? routes.admin : routes.artist}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {t(admin ? 'backAdmin' : 'backArtist')}
      </Link>
    </main>
  );
}
