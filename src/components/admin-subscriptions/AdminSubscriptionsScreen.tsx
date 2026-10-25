'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  ADMIN_SUBSCRIPTIONS,
  ADMIN_SUBSCRIPTION_TIME_ZONE,
  adminSubscriptionQuerySchema,
  type AdminSubscriptionQuery,
} from '@/config/admin-subscriptions';
import { fetchAdminSubscriptionDashboard } from '@/client/admin-subscriptions';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { InlineError } from '@/components/ui/InlineError';
import { Loading } from '@/components/ui/Loading';
import { adminSubscriptionPath, routes } from '@/config/routes';
import { AdminSubscriptionMetrics } from './AdminSubscriptionMetrics';
import { useAdminSubscriptionResource } from './useAdminSubscriptionResource';
import styles from './admin-subscriptions.module.css';

export function AdminSubscriptionsScreen({
  query,
  path,
}: {
  query: AdminSubscriptionQuery;
  path: string;
}) {
  const t = useTranslations('adminSubscriptions');
  const format = useFormatter();
  const router = useRouter();
  const [from, setFrom] = useState(query.from);
  const [to, setTo] = useState(query.to);
  const [invalid, setInvalid] = useState(false);
  const load = useCallback(
    (signal: AbortSignal) => fetchAdminSubscriptionDashboard(query, signal),
    [query],
  );
  const state = useAdminSubscriptionResource(path, load);
  const date = (instant: string) =>
    format.dateTime(new Date(instant), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: ADMIN_SUBSCRIPTION_TIME_ZONE,
    });
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
      <p className={styles.notice}>{t('boundary')}</p>
      <form
        className={styles.filters}
        aria-label={t('filterTitle')}
        data-admin-subscriptions-filters
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = adminSubscriptionQuerySchema.safeParse({
            ...query,
            from,
            to,
            page: 1,
          });
          if (!parsed.success) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          const destination = adminSubscriptionPath(parsed.data);
          if (destination === path) void state.refresh();
          else {
            state.clear();
            router.push(destination);
          }
        }}
      >
        <h2>{t('filterTitle')}</h2>
        <p className="ui-hint">
          {t('rangeHint', { days: ADMIN_SUBSCRIPTIONS.maxDays })}
        </p>
        <Input
          label={t('from')}
          type="date"
          value={from}
          required
          disabled={state.busy}
          onChange={(event) => {
            setFrom(event.currentTarget.value);
            setInvalid(false);
          }}
        />
        <Input
          label={t('to')}
          type="date"
          value={to}
          required
          disabled={state.busy}
          onChange={(event) => {
            setTo(event.currentTarget.value);
            setInvalid(false);
          }}
        />
        {invalid && (
          <p role="alert" className="ui-error-text">
            {t('formError', { days: ADMIN_SUBSCRIPTIONS.maxDays })}
          </p>
        )}
        <div className={styles.actions}>
          <Button type="submit" disabled={state.busy}>
            {t('apply')}
          </Button>
          <Button
            variant="secondary"
            disabled={state.busy}
            onClick={() => void state.refresh()}
          >
            {t('refresh')}
          </Button>
          {query.artist_id && (
            <Link
              href={adminSubscriptionPath({
                ...query,
                artist_id: null,
                page: 1,
              })}
              prefetch={false}
              onNavigate={state.clear}
              className="ui-button ui-button--secondary"
            >
              {t('allArtists')}
            </Link>
          )}
        </div>
      </form>
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
        <div className={styles.stack} data-admin-subscriptions-result>
          <div className={styles.stack} data-admin-subscriptions-window>
            <p>{t('snapshot', { date: date(state.data.as_of) })}</p>
            <p>{t('range', { from: state.data.from, to: state.data.to })}</p>
            {state.data.selected_artist && (
              <p>
                {t('filteredArtist')}: {state.data.selected_artist.name}
              </p>
            )}
          </div>
          <section className={styles.stack} data-admin-subscriptions-summary>
            <p>{t('currentNote')}</p>
            <p className="ui-hint">{t('partitionNote')}</p>
            <AdminSubscriptionMetrics {...state.data.summary} />
          </section>
          <section
            className={styles.definitions}
            data-admin-subscriptions-definitions
          >
            <h2>{t('definitionsTitle')}</h2>
            <p>{t('newDefinition')}</p>
            <p>{t('cancelDefinition')}</p>
            <p>{t('renewalDefinition')}</p>
            <p>{t('noFinancialData')}</p>
            <p>
              {t('historyStart', {
                date: date(state.data.cancellation_history_complete_from),
              })}
            </p>
            {Date.parse(state.data.window_start) <
              Date.parse(state.data.cancellation_history_complete_from) && (
              <p
                className={styles.notice}
                data-admin-subscriptions-history-warning
              >
                {t('historyIncomplete')}
              </p>
            )}
          </section>
          <section className={styles.stack} aria-label={t('artistsTitle')}>
            <h2>{t('artistsTitle')}</h2>
            <p>{t('artistCount', { count: state.data.total_artists })}</p>
            {state.data.artists.length ? (
              <ul className={styles.list}>
                {state.data.artists.map((artist) => (
                  <li
                    key={artist.id}
                    data-admin-subscriptions-artist={artist.id}
                  >
                    <Card title={artist.name}>
                      <p>
                        {t('artistStatus', {
                          status: t(`artistStatuses.${artist.status}`),
                        })}
                      </p>
                      <AdminSubscriptionMetrics
                        current={artist.current}
                        period={artist.period}
                        compact
                      />
                      {!query.artist_id && (
                        <Link
                          href={adminSubscriptionPath({
                            ...query,
                            artist_id: artist.id,
                            page: 1,
                          })}
                          prefetch={false}
                          onNavigate={state.clear}
                          className="ui-button ui-button--secondary"
                        >
                          {t('filterArtist')}
                        </Link>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            ) : (
              <Card title={t('emptyTitle')}>
                <p>{t('emptyDescription')}</p>
              </Card>
            )}
          </section>
          <nav
            className={styles.stack}
            aria-label={t('pagination')}
            data-admin-subscriptions-pagination
          >
            <p>{t('pageIndicator', { page: state.data.page })}</p>
            <div className={styles.actions}>
              {state.data.page > 1 && (
                <>
                  <Link
                    href={adminSubscriptionPath({ ...query, page: 1 })}
                    prefetch={false}
                    onNavigate={state.clear}
                    className="ui-button ui-button--secondary"
                  >
                    {t('firstPage')}
                  </Link>
                  <Link
                    href={adminSubscriptionPath({
                      ...query,
                      page: state.data.page - 1,
                    })}
                    prefetch={false}
                    onNavigate={state.clear}
                    className="ui-button ui-button--secondary"
                  >
                    {t('previousPage')}
                  </Link>
                </>
              )}
              {state.data.has_more &&
                state.data.page < ADMIN_SUBSCRIPTIONS.maxPage && (
                  <Link
                    href={adminSubscriptionPath({
                      ...query,
                      page: state.data.page + 1,
                    })}
                    prefetch={false}
                    onNavigate={state.clear}
                    className="ui-button ui-button--secondary"
                  >
                    {t('nextPage')}
                  </Link>
                )}
            </div>
          </nav>
        </div>
      )}
    </main>
  );
}
