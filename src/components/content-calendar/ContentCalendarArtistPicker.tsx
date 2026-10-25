'use client';
import Link from 'next/link';
import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { fetchContentCalendarArtists } from '@/client/content-calendar';
import { routes, adminContentCalendarPath } from '@/config/routes';
import { ADMIN_ARTISTS } from '@/config/admin-artists';
import { Button } from '@/components/ui/Button';
import { InlineError } from '@/components/ui/InlineError';
import { Loading } from '@/components/ui/Loading';
import { useContentCalendarResource } from './useContentCalendarResource';
import styles from './content-calendar.module.css';
export function ContentCalendarArtistPicker({
  month,
  page,
  path,
  actorKey,
}: {
  month: string;
  page: number;
  path: string;
  actorKey: string;
}) {
  const t = useTranslations('contentCalendar');
  const load = useCallback(
    (signal: AbortSignal) =>
      fetchContentCalendarArtists(page, signal, actorKey),
    [page, actorKey],
  );
  const state = useContentCalendarResource(path, load);
  return (
    <main className={`app-shell ${styles.screen}`} aria-busy={state.busy}>
      <Link
        href={routes.admin}
        prefetch={false}
        onNavigate={state.clear}
        className="ui-button ui-button--secondary"
      >
        {t('backAdmin')}
      </Link>
      <h1>{t('adminTitle')}</h1>
      <p>{t('adminDescription')}</p>
      <h2>{t('artistChoice')}</h2>
      <Button
        variant="secondary"
        disabled={state.busy}
        onClick={() => void state.refresh()}
      >
        {t('refresh')}
      </Button>
      {state.busy && <Loading label={t('loading')} />}
      {state.error && (
        <InlineError
          message={t(`errors.${state.error}`)}
          onRetry={state.refresh}
        />
      )}
      {state.data && (
        <>
          {!state.data.artists.length && <p>{t('artistEmpty')}</p>}
          <ul className={styles.list} data-testid="content-calendar-artists">
            {state.data.artists.map((artist) => (
              <li key={artist.id}>
                <Link
                  href={adminContentCalendarPath(month, artist.id)}
                  prefetch={false}
                  onNavigate={state.clear}
                  className="ui-button ui-button--secondary"
                >
                  {t('artistOption', {
                    name: artist.name,
                    slug: artist.slug,
                    status: t(`artistStatuses.${artist.status}`),
                  })}
                </Link>
              </li>
            ))}
          </ul>
          <nav className={styles.actions}>
            <p>{t('page', { page })}</p>
            {page > 1 && (
              <Link
                href={adminContentCalendarPath(month, null, page - 1)}
                prefetch={false}
                onNavigate={state.clear}
                className="ui-button ui-button--secondary"
              >
                {t('artistPrevious')}
              </Link>
            )}
            {state.data.has_more && page < ADMIN_ARTISTS.maxPage && (
              <Link
                href={adminContentCalendarPath(month, null, page + 1)}
                prefetch={false}
                onNavigate={state.clear}
                className="ui-button ui-button--secondary"
              >
                {t('artistNext')}
              </Link>
            )}
          </nav>
        </>
      )}
    </main>
  );
}
