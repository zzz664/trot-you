'use client';
import { useTranslations } from 'next-intl';
import type { ArtistContentCalendar } from '@/config/content-calendar';
import { ACTIVITY_TIME_ZONE } from '@/config/artist-reply-activity';
import { APP_LOCALE } from '@/config/constants';
import { Card } from '@/components/ui/Card';
import styles from './content-calendar.module.css';
function weekDate(value: string) {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: ACTIVITY_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value));
}
function activityDate(value: string) {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: ACTIVITY_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}
export function CalendarActivity({
  activity,
  serverNow,
}: Pick<ArtistContentCalendar, 'activity' | 'serverNow'>) {
  const t = useTranslations('artistReplyActivity');
  const calendar = useTranslations('contentCalendar');
  const metric = (count: number, minimum: number | null) =>
    minimum === null
      ? t('metricCount', { count })
      : t('metricProgress', { count, minimum });
  return (
    <section data-testid="content-calendar-activity">
      <Card title={t('activityTitle')}>
        <p>
          {t('weekRange', {
            start: weekDate(activity.weekStart),
            end: weekDate(activity.weekEnd),
          })}
        </p>
        <dl className={styles.metrics}>
          <div data-activity-metric="message">
            <dt>{t('messageMetric')}</dt>
            <dd>{metric(activity.messageCount, activity.weeklyMessageMin)}</dd>
          </div>
          <div data-activity-metric="photo">
            <dt>{t('photoMetric')}</dt>
            <dd>{metric(activity.photoCount, activity.weeklyPhotoMin)}</dd>
          </div>
        </dl>
        {!activity.requirementsReady && (
          <p className="ui-hint">{t('requirementsUnavailable')}</p>
        )}
        <p className="ui-hint">{calendar('currentWeekNotice')}</p>
        <p className="ui-hint">{t('activityNotice')}</p>
        <p className="ui-hint">{t('activityProvisional')}</p>
        <p className="ui-hint">
          {t('asOf', { date: activityDate(serverNow) })}
        </p>
      </Card>
    </section>
  );
}
