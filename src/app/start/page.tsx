import { LegalDocumentLinks } from '@/components/legal-documents/LegalDocumentLinks';
import { getTranslations } from 'next-intl/server';
import { ArtistCatalogEntry } from '@/components/artists/ArtistCatalogEntry';
import { AuthForm } from '@/components/auth/AuthForm';
import { AUTH_START_MESSAGES } from '@/config/auth';
import { routes } from '@/config/routes';
import { guardPage } from '@/server/auth/page';
import { safeReturnPath } from '@/server/services/auth/access';

export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const state = await guardPage(routes.start);
  const params = await searchParams;
  const next = safeReturnPath(params.next);
  const message = AUTH_START_MESSAGES.find((value) => value === params.reason);
  const t = await getTranslations('auth');
  const configured = state.status !== 'unconfigured';
  return (
    <main className="app-shell">
      <h1>{t('startTitle')}</h1>
      <p>{t('startDescription')}</p>
      {message && <p role="status">{t(message)}</p>}
      {!configured && <p id="login-help">{t('unavailable')}</p>}
      {state.status === 'unavailable' && (
        <p role="alert">{t('serviceUnavailable')}</p>
      )}
      <AuthForm
        action={`${routes.authLogin}?next=${encodeURIComponent(next)}`}
        label={t('login')}
        pendingLabel={t('loginPending')}
        disabled={!configured}
        {...(!configured ? { describedBy: 'login-help' } : {})}
      />
      <ArtistCatalogEntry />
      <LegalDocumentLinks />
      {state.status === 'unavailable' && (
        <AuthForm
          action={routes.authLogout}
          label={t('logout')}
          pendingLabel={t('logoutPending')}
        />
      )}
    </main>
  );
}
