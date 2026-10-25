import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { DispatchErrorScreen } from '@/components/artist-dispatch/DispatchErrorScreen';
import {
  artistDispatchMenuPath,
  artistDispatchPath,
  routes,
} from '@/config/routes';
import { getDispatchHistoryMenu } from '@/server/message-dispatch/history-page';
export default async function DispatchHistoryMenu({
  searchParams,
}: {
  searchParams: Promise<{ after?: string | string[] }>;
}) {
  const { after } = await searchParams;
  const result = await getDispatchHistoryMenu(after ?? null);
  if (!result.ok) return <DispatchErrorScreen code={result.code} />;
  const t = await getTranslations('artistDispatch');
  return (
    <main className="app-shell">
      <Link
        href={routes.artist}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {t('back')}
      </Link>
      <h1>{t('menuTitle')}</h1>
      <p>{t('menuDescription')}</p>
      <Card title={t('history')}>
        {!result.data.artists.length ? (
          <p>{t('menuEmpty')}</p>
        ) : (
          result.data.artists.map((artist) => (
            <Link
              key={artist.id}
              href={artistDispatchPath(artist.slug)}
              prefetch={false}
              className="ui-button ui-button--primary"
            >
              {t('menuOpen', { name: artist.name })}
            </Link>
          ))
        )}
        {result.data.nextSlug && (
          <Link
            href={artistDispatchMenuPath(result.data.nextSlug)}
            prefetch={false}
            className="ui-button ui-button--secondary"
          >
            {t('menuMore')}
          </Link>
        )}
        {after && (
          <Link
            href={routes.artistDispatchHistory}
            prefetch={false}
            className="ui-button ui-button--secondary"
          >
            {t('menuFirst')}
          </Link>
        )}
      </Card>
    </main>
  );
}
