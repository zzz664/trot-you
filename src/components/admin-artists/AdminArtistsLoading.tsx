'use client';

import { useTranslations } from 'next-intl';
import { Loading } from '@/components/ui/Loading';

export function AdminArtistsLoading({ access = false }: { access?: boolean }) {
  const t = useTranslations('adminArtists');
  return (
    <main className="app-shell onboarding-shell">
      <h1>{t(access ? 'accessTitle' : 'title')}</h1>
      <Loading label={t('loading')} />
    </main>
  );
}
