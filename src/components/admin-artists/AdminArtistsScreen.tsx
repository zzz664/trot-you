'use client';
import Link from 'next/link';
import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { ADMIN_ARTISTS } from '@/config/admin-artists';
import { fetchAdminArtists } from '@/client/admin-artists';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { InlineError } from '@/components/ui/InlineError';
import { Loading } from '@/components/ui/Loading';
import { adminArtistListPath, adminArtistPath, routes } from '@/config/routes';
import { useAdminResource } from './useAdminResource';
import styles from './admin-artists.module.css';

export function AdminArtistsScreen({ page }: { page: number }) {
  const t = useTranslations('adminArtists');
  const load = useCallback(
    (signal: AbortSignal) => fetchAdminArtists(page, signal),
    [page],
  );
  const state = useAdminResource(adminArtistListPath(page), load);
  return (
    <main className={`app-shell onboarding-shell ${styles.screen}`}>
      <Link
        href={routes.admin}
        prefetch={false}
        onNavigate={state.clear}
        className="ui-button ui-button--secondary"
      >
        {t('back')}
      </Link>
      <header>
        <h1>{t('title')}</h1>
        <p>{t('description')}</p>
      </header>
      <div className={styles.actions}>
        <Button
          variant="secondary"
          disabled={state.busy}
          onClick={() => void state.refresh()}
        >
          {t('refresh')}
        </Button>
        {state.data && (
          <Link
            href={adminArtistPath('new')}
            prefetch={false}
            onNavigate={state.clear}
            className="ui-button ui-button--primary"
          >
            {t('create')}
          </Link>
        )}
      </div>
      {state.busy && <Loading label={t('loading')} />}
      {state.error && (
        <InlineError
          message={t(`errors.${state.error}`)}
          onRetry={state.refresh}
        />
      )}
      {state.error === 'UNAUTHENTICATED' && (
        <Link
          href={routes.start}
          prefetch={false}
          onNavigate={state.clear}
          className="ui-button ui-button--primary"
        >
          {t('signIn')}
        </Link>
      )}
      {state.data && (
        <>
          {state.data.artists.length ? (
            <ul className={styles.list}>
              {state.data.artists.map((artist) => (
                <li key={artist.id} data-admin-artist-id={artist.id}>
                  <Card title={artist.name}>
                    <p>{t(`status.${artist.status}`)}</p>
                    {artist.intro && (
                      <p className={styles.message}>{artist.intro}</p>
                    )}
                    <dl className={styles.details}>
                      <div>
                        <dt>{t('slug')}</dt>
                        <dd>{artist.slug}</dd>
                      </div>
                      <div>
                        <dt>{t('sortOrder')}</dt>
                        <dd>{artist.display_order}</dd>
                      </div>
                    </dl>
                    <Link
                      href={adminArtistPath(artist.id)}
                      prefetch={false}
                      onNavigate={state.clear}
                      className="ui-button ui-button--secondary"
                    >
                      {t('edit')}
                    </Link>
                  </Card>
                </li>
              ))}
            </ul>
          ) : (
            <Card title={t('emptyTitle')}>
              <p>{t('emptyDescription')}</p>
            </Card>
          )}
          <nav className={styles.actions} aria-label={t('pagination')}>
            {page > 1 && (
              <Link
                href={routes.adminArtists}
                prefetch={false}
                onNavigate={state.clear}
                className="ui-button ui-button--secondary"
              >
                {t('first')}
              </Link>
            )}
            {state.data.has_more && page < ADMIN_ARTISTS.maxPage && (
              <Link
                href={adminArtistListPath(page + 1)}
                prefetch={false}
                onNavigate={state.clear}
                className="ui-button ui-button--secondary"
              >
                {t('next')}
              </Link>
            )}
          </nav>
        </>
      )}
    </main>
  );
}
