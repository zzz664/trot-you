'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  ANALYTICS_FUNNEL,
  analyticsFunnelQuerySchema,
  type AnalyticsFunnelDashboard,
  type AnalyticsFunnelQuery,
} from '@/config/analytics-funnel';
import { analyticsFunnelPath, routes } from '@/config/routes';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { InlineError } from '@/components/ui/InlineError';
import { Loading } from '@/components/ui/Loading';
import { useAnalyticsFunnel } from './useAnalyticsFunnel';
import styles from './analytics-funnel.module.css';
type Props = { actorKey: string; query: AnalyticsFunnelQuery; path: string };
export function AnalyticsFunnelScreen(props: Props) {
  return (
    <AnalyticsFunnelSession
      key={`${props.actorKey}:${props.path}:${props.query.from}:${props.query.to}`}
      {...props}
    />
  );
}
function AnalyticsFunnelSession({ actorKey, query, path }: Props) {
  const t = useTranslations('analyticsFunnel');
  const router = useRouter();
  const state = useAnalyticsFunnel(actorKey, query, path);
  const [from, setFrom] = useState(query.from);
  const [to, setTo] = useState(query.to);
  const [invalid, setInvalid] = useState(false);
  const navigation = useRef(false);
  const [navigating, setNavigating] = useState(false);
  return (
    <main className={`app-shell ${styles.screen}`} aria-busy={state.busy}>
      <Link
        href={routes.admin}
        prefetch={false}
        onNavigate={state.clear}
        className="ui-button ui-button--secondary"
      >
        {t('back')}
      </Link>
      <h1>{t('title')}</h1>
      <p>{t('description')}</p>
      <form
        className={styles.stack}
        aria-label={t('filterTitle')}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (navigation.current) return;
          const parsed = analyticsFunnelQuerySchema.safeParse({ from, to });
          if (!parsed.success) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          const destination = analyticsFunnelPath(parsed.data);
          if (parsed.data.from === query.from && parsed.data.to === query.to)
            void state.refresh();
          else {
            navigation.current = true;
            setNavigating(true);
            state.clear();
            router.push(destination);
          }
        }}
      >
        <h2>{t('filterTitle')}</h2>
        <p>{t('rangeHint', { days: ANALYTICS_FUNNEL.maxDays })}</p>
        <Input
          label={t('from')}
          type="date"
          value={from}
          required
          disabled={state.busy || navigating}
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
          disabled={state.busy || navigating}
          onChange={(event) => {
            setTo(event.currentTarget.value);
            setInvalid(false);
          }}
        />
        {invalid && (
          <p role="alert" className="ui-error-text">
            {t('formError', { days: ANALYTICS_FUNNEL.maxDays })}
          </p>
        )}
        <div className={styles.actions}>
          <Button type="submit" disabled={state.busy || navigating}>
            {t('apply')}
          </Button>
          <Button
            variant="secondary"
            disabled={state.busy || navigating}
            onClick={() => void state.refresh()}
          >
            {t('refresh')}
          </Button>
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
        <AnalyticsFunnelSnapshot key={state.data.as_of} data={state.data} />
      )}
    </main>
  );
}
function AnalyticsFunnelSnapshot({ data }: { data: AnalyticsFunnelDashboard }) {
  const t = useTranslations('analyticsFunnel');
  const format = useFormatter();
  const [page, setPage] = useState(0);
  const date = (value: string) =>
    format.dateTime(new Date(value), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: ANALYTICS_FUNNEL.timeZone,
    });
  const start = page * ANALYTICS_FUNNEL.dailyPageSize;
  const daily = data.daily.slice(start, start + ANALYTICS_FUNNEL.dailyPageSize);
  const maximum = Math.max(
    1,
    ...data.events.map((event) => event.event_count ?? 0),
  );
  return (
    <div className={styles.stack} data-testid="analytics-funnel-content">
      <section className={styles.notice} aria-label={t('coverageTitle')}>
        <h2>{t('coverageTitle')}</h2>
        <p>{t('snapshot', { date: date(data.as_of) })}</p>
        <p>{t('range', { from: data.from, to: data.to })}</p>
        <p>{t('rawDefinition')}</p>
        <p>{t('consentDefinition')}</p>
        <p>{t('historyIncomplete')}</p>
        <p>
          {t('instrumentationFrom', {
            date: date(data.coverage.instrumentation_from),
          })}
        </p>
        <p>{t('fontUnavailable')}</p>
        <p>{t('privacy')}</p>
        {data.collection.retention_days !== null && (
          <p>{t('retention', { days: data.collection.retention_days })}</p>
        )}
      </section>
      {data.collection.status !== 'enabled' && (
        <section
          className={styles.notice}
          data-testid="analytics-funnel-policy-unavailable"
        >
          <h2>{t('collectionTitle')}</h2>
          <p>{t(`collection.${data.collection.status}`)}</p>
        </section>
      )}
      <section
        className={styles.stack}
        data-testid="analytics-funnel-totals"
        aria-labelledby="analytics-totals-title"
      >
        <h2 id="analytics-totals-title">{t('totalsTitle')}</h2>
        <p>{t('chartHint')}</p>
        <ul className={styles.list}>
          {data.events.map((event) => (
            <li
              key={event.name}
              className={styles.panel}
              data-analytics-event={event.name}
            >
              <h3>{t(`events.${event.name}`)}</h3>
              <code>{event.name}</code>
              <p>
                {event.event_count === null
                  ? t('countUnavailable')
                  : t('eventCount', {
                      count: format.number(event.event_count),
                    })}
              </p>
              {event.event_count !== null && (
                <meter
                  className={styles.bar}
                  min={0}
                  max={maximum}
                  value={event.event_count}
                  aria-label={t('barLabel', {
                    event: t(`events.${event.name}`),
                    count: format.number(event.event_count),
                  })}
                />
              )}
            </li>
          ))}
        </ul>
      </section>
      <section
        className={styles.stack}
        data-testid="analytics-funnel-daily"
        aria-labelledby="analytics-daily-title"
      >
        <h2 id="analytics-daily-title">{t('dailyTitle')}</h2>
        <p>{t('dailyHint')}</p>
        {data.collection.status !== 'enabled' ? (
          <p>{t('countUnavailable')}</p>
        ) : data.daily.length === 0 ? (
          <p>{t('empty')}</p>
        ) : (
          <>
            <p>
              {t('dailyRange', {
                from: start + 1,
                to: start + daily.length,
                total: data.daily.length,
              })}
            </p>
            <ol className={styles.list}>
              {daily.map((row) => (
                <li
                  className={styles.panel}
                  key={`${row.day_kst}:${row.name}`}
                  data-analytics-day={row.day_kst}
                >
                  <h3>{row.day_kst}</h3>
                  <p>{t(`events.${row.name}`)}</p>
                  <p>
                    {t('eventCount', { count: format.number(row.event_count) })}
                  </p>
                </li>
              ))}
            </ol>
            <nav className={styles.actions} aria-label={t('pagination')}>
              <Button
                variant="secondary"
                disabled={page === 0}
                onClick={() => setPage((value) => value - 1)}
              >
                {t('previous')}
              </Button>
              <Button
                variant="secondary"
                disabled={start + daily.length >= data.daily.length}
                onClick={() => setPage((value) => value + 1)}
              >
                {t('next')}
              </Button>
            </nav>
          </>
        )}
      </section>
      <section
        className={styles.stack}
        data-testid="analytics-funnel-metrics"
        aria-labelledby="analytics-metrics-title"
      >
        <h2 id="analytics-metrics-title">{t('metricsTitle')}</h2>
        <p>{t('metricsDescription')}</p>
        {Array.from({ length: ANALYTICS_FUNNEL.metricSlots }, (_, index) => (
          <Card key={index} title={t('metricTitle', { number: index + 1 })}>
            <p>{t('metricUnavailable')}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
