import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArtistAccessEntry } from '@/components/admin-artists/AdminArtistsEntry';
import { AuthForm } from '@/components/auth/AuthForm';
import { Card } from '@/components/ui/Card';
import { ComposeErrorScreen } from '@/components/artist-compose-menu/ComposeErrorScreen';
import {
  artistComposeMenuPath,
  artistComposePath,
  routes,
} from '@/config/routes';
import { getComposeMenu } from '@/server/artist-compose/page';

export default async function ArtistPage({
  searchParams,
}: {
  searchParams: Promise<{ after?: string | string[] }>;
}) {
  const { after } = await searchParams;
  const result = await getComposeMenu(after ?? null);
  if (!result.ok) return <ComposeErrorScreen code={result.code} />;
  const t = await getTranslations('artistComposeMenu');
  const auth = await getTranslations('auth');
  const dispatch = await getTranslations('artistDispatch');
  const activity = await getTranslations('artistReplyActivity');
  const account = await getTranslations('adminArtists');
  return (
    <main className="app-shell">
      <h1>{auth('artistTitle')}</h1>
      <p>{t('description')}</p>
      <ArtistAccessEntry label={account('accessEntry')} />
      <Link
        href={routes.artistDispatchHistory}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {dispatch('menuTitle')}
      </Link>
      <Link
        href={routes.artistReplyActivityMenu}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {activity('menuTitle')}
      </Link>
      <Card title={t('title')}>
        {result.data.artists.length === 0 ? (
          <p>{t('empty')}</p>
        ) : (
          result.data.artists.map((artist) => (
            <Link
              key={artist.id}
              href={artistComposePath(artist.slug)}
              prefetch={false}
              className="ui-button ui-button--primary"
            >
              {t('compose', { name: artist.name })}
            </Link>
          ))
        )}
        {result.data.nextSlug && (
          <Link
            href={artistComposeMenuPath(result.data.nextSlug)}
            prefetch={false}
            className="ui-button ui-button--secondary"
          >
            {t('more')}
          </Link>
        )}
        {after && (
          <Link
            href={routes.artist}
            prefetch={false}
            className="ui-button ui-button--secondary"
          >
            {t('first')}
          </Link>
        )}
      </Card>
      <Card title={auth('sessionTitle')}>
        <p>{auth('sessionDescription')}</p>
        <p>{auth('roleLabel', { role: auth('artist') })}</p>
        <AuthForm
          action={routes.authLogout}
          label={auth('logout')}
          pendingLabel={auth('logoutPending')}
        />
      </Card>
    </main>
  );
}
