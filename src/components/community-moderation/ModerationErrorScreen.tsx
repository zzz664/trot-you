'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { CommunityError } from '@/config/community-posts';
import { routes } from '@/config/routes';
import { InlineError } from '@/components/ui/InlineError';
export function ModerationErrorScreen({
  code,
  admin = false,
}: {
  code: CommunityError;
  admin?: boolean;
}) {
  const t = useTranslations('communityModeration');
  const errors = useTranslations('communityPosts.errors');
  const router = useRouter();
  return (
    <main className="app-shell">
      <h1>{t(admin ? 'adminTitle' : 'inboxTitle')}</h1>
      <InlineError message={errors(code)} onRetry={() => router.refresh()} />
      <Link
        href={admin ? routes.admin : routes.home}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {t('back')}
      </Link>
    </main>
  );
}
