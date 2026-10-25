'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { InlineError } from '@/components/ui/InlineError';
import { routes } from '@/config/routes';
import type { DispatchError } from '@/config/message-dispatch';
export function DispatchErrorScreen({ code }: { code: DispatchError }) {
  const router = useRouter();
  const t = useTranslations('artistDispatch');
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
