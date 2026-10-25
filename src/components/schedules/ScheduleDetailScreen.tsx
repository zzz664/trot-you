'use client';
import Link from 'next/link';
import { useCallback } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { fetchSchedule } from '@/client/schedules';
import { SCHEDULES } from '@/config/schedules';
import { getPublicAppOrigin } from '@/config/env';
import { routes, scheduleListPath } from '@/config/routes';
import { getScheduleMapLinks } from '@/lib/map-links';
import { ExternalLink } from '@/components/ui/ExternalLink';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Loading } from '@/components/ui/Loading';
import { InlineError } from '@/components/ui/InlineError';
import { useScheduleResource } from './useScheduleResource';
import { ScheduleNoticeControls } from '@/components/schedule-notices/ScheduleNoticeControls';
import styles from './schedules.module.css';
export function ScheduleDetailScreen({
  id,
  month,
  path,
  actorKey,
  canConfigureNotices = false,
}: {
  id: string;
  month: string | null;
  path: string;
  actorKey?: string;
  canConfigureNotices?: boolean;
}) {
  const t = useTranslations('schedules');
  const format = useFormatter();
  const load = useCallback(
    (signal: AbortSignal) => fetchSchedule(id, signal, actorKey),
    [id, actorKey],
  );
  const state = useScheduleResource(path, load);
  const event = state.data;
  const date = (value: string) =>
    format.dateTime(new Date(value), {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: SCHEDULES.timeZone,
    });
  const links = event
    ? getScheduleMapLinks(event.lat, event.lng, getPublicAppOrigin())
    : null;
  return (
    <main className={`app-shell onboarding-shell ${styles.screen}`}>
      <Link
        href={month ? scheduleListPath(month) : routes.schedules}
        prefetch={false}
        onNavigate={state.clear}
        className="ui-button ui-button--secondary"
      >
        {t('backList')}
      </Link>
      <h1>{t('detailTitle')}</h1>
      <p className="ui-hint">{t('timeZone')}</p>
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
      {event && (
        <>
          <Card title={event.title}>
            <dl className={styles.details}>
              <div>
                <dt>{t('artist')}</dt>
                <dd>{event.artist_name}</dd>
              </div>
              <div>
                <dt>{t('typeLabel')}</dt>
                <dd>{t(`types.${event.type}`)}</dd>
              </div>
              <div>
                <dt>{t('start')}</dt>
                <dd>{date(event.starts_at)}</dd>
              </div>
              <div>
                <dt>{t('end')}</dt>
                <dd>{event.ends_at ? date(event.ends_at) : t('endUnknown')}</dd>
              </div>
              <div>
                <dt>{t('place')}</dt>
                <dd>{event.place_name ?? t('placeUnknown')}</dd>
              </div>
              {event.address && (
                <div>
                  <dt>{t('address')}</dt>
                  <dd>{event.address}</dd>
                </div>
              )}
            </dl>
            <h3>{t('descriptionLabel')}</h3>
            <p className={styles.description}>
              {event.description || t('noDescription')}
            </p>
          </Card>
          <section className={styles.stack} data-testid="schedule-map-links">
            <h2>{t('mapTitle')}</h2>
            <p>{t('mapHint')}</p>
            {links ? (
              <>
                <div className={styles.actions}>
                  {links.naver && (
                    <ExternalLink href={links.naver}>
                      {t('naverMap')}
                    </ExternalLink>
                  )}
                  <ExternalLink href={links.kakao}>
                    {t('kakaoMap')}
                  </ExternalLink>
                </div>
                <p className="ui-hint">
                  {t(links.naver ? 'naverHint' : 'naverUnsupported')}
                </p>
              </>
            ) : (
              <p>{t('mapUnavailable')}</p>
            )}
          </section>
          {canConfigureNotices && (
            <ScheduleNoticeControls
              scheduleId={id}
              path={path}
              actorKey={actorKey}
            />
          )}
        </>
      )}
    </main>
  );
}
