'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BackButton } from '@/components/ui/BackButton';
import { InlineError } from '@/components/ui/InlineError';
import type { ChatError } from '@/config/chat';
import { artistPreviewPath, routes } from '@/config/routes';

export function ChatErrorScreen({
  code,
  slug,
  onRetry,
}: {
  code: ChatError;
  slug?: string;
  onRetry?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const t = useTranslations('chat');
  return (
    <main className="app-shell chat-shell">
      <nav aria-label={t('navigation')}>
        <BackButton fallbackHref={routes.artists} />
      </nav>
      <h1>{t('errorTitle')}</h1>
      <InlineError
        message={t(`errors.${code}`)}
        onRetry={onRetry ?? (() => router.refresh())}
      />
      {code === 'UNAUTHENTICATED' && (
        <Link
          className="ui-button ui-button--primary"
          href={routes.start}
          prefetch={false}
        >
          {t('signIn')}
        </Link>
      )}
      {code === 'PROFILE_REQUIRED' && (
        <Link
          className="ui-button ui-button--primary"
          href={routes.onboarding}
          prefetch={false}
        >
          {t('profile')}
        </Link>
      )}
      {slug && code === 'SUBSCRIPTION_REQUIRED' && (
        <Link
          className="ui-button ui-button--primary"
          href={artistPreviewPath(slug)}
          prefetch={false}
        >
          {t('preview')}
        </Link>
      )}
      <Link
        className="ui-button ui-button--secondary"
        href={routes.subscriptions}
        prefetch={false}
      >
        {t('subscriptions')}
      </Link>
    </main>
  );
}
