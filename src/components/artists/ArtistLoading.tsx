import { useTranslations } from 'next-intl';
import { Loading } from '@/components/ui/Loading';

export function ArtistLoading() {
  const t = useTranslations('artists');
  return (
    <main className="app-shell artist-shell">
      <h1>{t('catalogTitle')}</h1>
      <Loading label={t('loading')} />
    </main>
  );
}
