'use client';
import Link from 'next/link';
import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { fetchAdminSchedules } from '@/client/schedules';
import type { AdminScheduleQuery } from '@/config/schedules';
import {
  routes,
  adminSchedulePath,
  adminScheduleListPath,
} from '@/config/routes';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Loading';
import { InlineError } from '@/components/ui/InlineError';
import { MonthNavigation } from './MonthNavigation';
import { ScheduleCard } from './ScheduleCard';
import { useScheduleResource } from './useScheduleResource';
import styles from './schedules.module.css';
export function AdminSchedulesScreen({
  query,
  path,
  actorKey,
}: {
  query: AdminScheduleQuery;
  path: string;
  actorKey?: string;
}) {
  const t = useTranslations('schedules');
  const load = useCallback(
    (signal: AbortSignal) => fetchAdminSchedules(query, signal, actorKey),
    [query, actorKey],
  );
  const state = useScheduleResource(path, load);
  return (
    <main className={`app-shell onboarding-shell ${styles.screen}`}>
      <Link
        href={routes.admin}
        prefetch={false}
        onNavigate={state.clear}
        className="ui-button ui-button--secondary"
      >
        {t('backAdmin')}
      </Link>
      <header>
        <h1>{t('adminTitle')}</h1>
        <p>{t('adminDescription')}</p>
        <p className="ui-hint">{t('statusHint')}</p>
        <p className="ui-hint">{t('timeZone')}</p>
      </header>
      <div className={styles.actions}>
        <Link
          href={adminSchedulePath('new')}
          prefetch={false}
          onNavigate={state.clear}
          className="ui-button ui-button--primary"
        >
          {t('new')}
        </Link>
        <Button
          variant="secondary"
          disabled={state.busy}
          onClick={() => void state.refresh()}
        >
          {t('refresh')}
        </Button>
      </div>
      <MonthNavigation admin month={query.month} onNavigate={state.clear} />
      {state.busy && <Loading label={t('loading')} />}
      {state.error && (
        <InlineError
          message={t(`errors.${state.error}`)}
          onRetry={state.refresh}
        />
      )}
      {state.data && (
        <>
          <ul className={styles.list} data-testid="admin-schedule-list">
            {state.data.items.map((event) => (
              <li key={event.id}>
                <ScheduleCard
                  admin
                  event={event}
                  month={query.month}
                  onNavigate={state.clear}
                />
              </li>
            ))}
          </ul>
          {!state.data.items.length && <p>{t('adminEmpty')}</p>}
          <nav className={styles.actions}>
            <p>{t('page', { page: query.page })}</p>
            {query.page > 1 && (
              <Link
                href={adminScheduleListPath(query.month, query.page - 1)}
                prefetch={false}
                onNavigate={state.clear}
                className="ui-button ui-button--secondary"
              >
                {t('previousPage')}
              </Link>
            )}
            {state.data.has_more && (
              <Link
                href={adminScheduleListPath(query.month, query.page + 1)}
                prefetch={false}
                onNavigate={state.clear}
                className="ui-button ui-button--secondary"
              >
                {t('nextPage')}
              </Link>
            )}
          </nav>
        </>
      )}
    </main>
  );
}
