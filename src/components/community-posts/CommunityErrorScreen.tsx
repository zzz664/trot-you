'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { InlineError } from '@/components/ui/InlineError';
import { routes } from '@/config/routes';
import type { CommunityError } from '@/config/community-posts';
export function CommunityErrorScreen({ code }: { code: CommunityError }) {
  const t = useTranslations('communityPosts');
  const router = useRouter();
  return (
    <main className="app-shell">
      <h1>{t('title')}</h1>
      <InlineError
        message={t(`errors.${code}`)}
        onRetry={() => router.refresh()}
      />
      <Link
        href={routes.artists}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {t('backArtists')}
      </Link>
    </main>
  );
}
