'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { routes } from '@/config/routes';

export function ArtistCatalogEntry() {
  const router = useRouter();
  const t = useTranslations('artists');
  return (
    <Button variant="secondary" onClick={() => router.push(routes.artists)}>
      {t('catalogTitle')}
    </Button>
  );
}
