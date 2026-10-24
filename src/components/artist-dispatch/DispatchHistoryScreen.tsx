'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { routes } from '@/config/routes';
import { ArtistDispatch } from './ArtistDispatch';

export function DispatchHistoryScreen({
  slug,
  name,
}: {
  slug: string;
  name: string;
}) {
  const t = useTranslations('artistDispatch');
  const router = useRouter();
  const [locked, setLocked] = useState(false);
  return (
    <main className="app-shell">
      <Button
        variant="secondary"
        disabled={locked}
        onClick={() => router.replace(routes.artistDispatchHistory)}
      >
        {t('backToHistoryArtists')}
      </Button>
      <h1>{t('historyTitle', { name })}</h1>
      <p>{t('historyNotice')}</p>
      <ArtistDispatch
        slug={slug}
        draft={null}
        disabled={false}
        historyOnly
        onLock={setLocked}
        onPublished={async () => true}
        onAccessLost={() => undefined}
      />
    </main>
  );
}
