import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { ArtistReplyActivityErrorScreen } from '@/components/artist-reply-activity/ArtistReplyActivityErrorScreen';
import {
  artistReplyActivityMenuPath,
  artistReplyActivityPath,
  routes,
} from '@/config/routes';
import { getArtistReplyActivityMenu } from '@/server/artist-reply-activity/page';

export default async function ArtistReplyActivityMenu({
  searchParams,
}: {
  searchParams: Promise<{ after?: string | string[] }>;
}) {
  const { after } = await searchParams;
  const result = await getArtistReplyActivityMenu(after ?? null);
  if (!result.ok) return <ArtistReplyActivityErrorScreen code={result.code} />;
  const t = await getTranslations('artistReplyActivity');
  const moderationCopy = await getTranslations('communityModeration');
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
      <Link
        href={routes.communityReports}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {moderationCopy('inboxEntry')}
      </Link>
      <Card title={t('repliesTitle')}>
        {result.data.artists.length === 0 ? (
          <p>{t('menuEmpty')}</p>
        ) : (
          result.data.artists.map((artist) => (
            <Link
              key={artist.id}
              href={artistReplyActivityPath(artist.slug)}
              prefetch={false}
              className="ui-button ui-button--primary"
            >
              {t('menuOpen', { name: artist.name })}
            </Link>
          ))
        )}
        {result.data.nextSlug && (
          <Link
            href={artistReplyActivityMenuPath(result.data.nextSlug)}
            prefetch={false}
            className="ui-button ui-button--secondary"
          >
            {t('menuMore')}
          </Link>
        )}
        {after && (
          <Link
            href={routes.artistReplyActivityMenu}
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
