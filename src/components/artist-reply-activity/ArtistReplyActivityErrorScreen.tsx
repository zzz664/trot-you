'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { InlineError } from '@/components/ui/InlineError';
import type { ArtistReplyActivityError } from '@/config/artist-reply-activity';
import { routes } from '@/config/routes';

export function ArtistReplyActivityErrorScreen({
  code,
}: {
  code: ArtistReplyActivityError;
}) {
  const t = useTranslations('artistReplyActivity');
  const router = useRouter();
  return (
    <main className="app-shell">
      <h1>{t('errorTitle')}</h1>
      <InlineError
        message={t(`errors.${code}`)}
        onRetry={() => router.refresh()}
      />
      <Link
        href={routes.artist}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {t('back')}
      </Link>
    </main>
  );
}
