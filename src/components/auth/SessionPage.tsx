import { getTranslations } from 'next-intl/server';
import { ArtistCatalogEntry } from '@/components/artists/ArtistCatalogEntry';
import { AuthForm } from './AuthForm';
import { Card } from '@/components/ui/Card';
import { routes } from '@/config/routes';
import { guardPage } from '@/server/auth/page';

export async function SessionPage({ path }: { path: string }) {
  const state = await guardPage(path);
  if (state.status !== 'authenticated') return null;
  const t = await getTranslations('auth');
  const title =
    path === routes.restricted
      ? 'restrictedTitle'
      : path === routes.onboarding
        ? 'pendingTitle'
        : state.profile.role === 'artist'
          ? 'artistTitle'
          : state.profile.role === 'admin'
            ? 'adminTitle'
            : 'fanTitle';
  const description =
    path === routes.restricted
      ? 'restrictedDescription'
      : path === routes.onboarding
        ? 'pendingDescription'
        : 'featurePending';
  return (
    <main className="app-shell">
      <h1>{t(title)}</h1>
      <p>{t(description)}</p>
      {path === routes.home && state.profile.role === 'fan' && (
        <ArtistCatalogEntry />
      )}
      <Card title={t('sessionTitle')}>
        <p>{t('sessionDescription')}</p>
        <p>{t('roleLabel', { role: t(state.profile.role) })}</p>
        <AuthForm
          action={routes.authLogout}
          label={t('logout')}
          pendingLabel={t('logoutPending')}
        />
      </Card>
    </main>
  );
}
