'use client';

import { useTranslations } from 'next-intl';
import { Loading } from '@/components/ui/Loading';

export function ChatLoading() {
  const t = useTranslations('chat');
  return (
    <main className="app-shell chat-shell">
      <h1>{t('loadingTitle')}</h1>
      <Loading label={t('loading')} />
    </main>
  );
}
