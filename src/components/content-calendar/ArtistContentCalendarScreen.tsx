'use client';
import Link from 'next/link';
import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { fetchArtistContentCalendar } from '@/client/content-calendar';
import { routes } from '@/config/routes';
import { Loading } from '@/components/ui/Loading';
import { Button } from '@/components/ui/Button';
import { InlineError } from '@/components/ui/InlineError';
import { CalendarActivity } from './CalendarActivity';
import { CalendarEntries } from './CalendarEntries';
import { CalendarMonthNavigation } from './CalendarMonthNavigation';
import { useContentCalendarResource } from './useContentCalendarResource';
import styles from './content-calendar.module.css';
export function ArtistContentCalendarScreen({
  slug,
  month,
  actorKey,
  path,
}: {
  slug: string;
  month: string;
  actorKey: string;
  path: string;
}) {
  const t = useTranslations('contentCalendar');
  const load = useCallback(
    (signal: AbortSignal) =>
      fetchArtistContentCalendar({ slug, month }, signal, actorKey),
    [slug, month, actorKey],
  );
  const state = useContentCalendarResource(path, load);
  return (
    <main className={`app-shell ${styles.screen}`} aria-busy={state.busy}>
      <Link
        href={routes.artist}
        prefetch={false}
        onNavigate={state.clear}
        className="ui-button ui-button--secondary"
      >
        {t('backArtist')}
      </Link>
      <h1>
        {state.data
          ? t('artistTitle', { name: state.data.artist.name })
          : t('title')}
      </h1>
      <p>{t('description')}</p>
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
        <div className={styles.stack}>
          <CalendarActivity
            activity={state.data.activity}
            serverNow={state.data.serverNow}
          />
          <CalendarMonthNavigation
            month={month}
            slug={slug}
            onNavigate={state.clear}
          />
          <CalendarEntries entries={state.data.entries} />
        </div>
      )}
    </main>
  );
}
