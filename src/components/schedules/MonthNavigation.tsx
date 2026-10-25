'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { adminScheduleListPath, scheduleListPath } from '@/config/routes';
import { scheduleMonthShift } from '@/lib/schedule-view';
import styles from './schedules.module.css';
export function MonthNavigation({
  month,
  admin = false,
  onNavigate,
}: {
  month: string;
  admin?: boolean;
  onNavigate: () => void;
}) {
  const t = useTranslations('schedules');
  const [year, number] = month.split('-');
  const previous = scheduleMonthShift(month, -1);
  const next = scheduleMonthShift(month, 1);
  const path = (value: string) =>
    admin ? adminScheduleListPath(value) : scheduleListPath(value);
  return (
    <section
      className={styles.stack}
      aria-label={t('month', { year: Number(year), month: Number(number) })}
    >
      <h2>{t('month', { year: Number(year), month: Number(number) })}</h2>
      <nav className={styles.actions}>
        {previous && (
          <Link
            href={path(previous)}
            prefetch={false}
            onNavigate={onNavigate}
            className="ui-button ui-button--secondary"
          >
            {t('previousMonth')}
          </Link>
        )}
        {next && (
          <Link
            href={path(next)}
            prefetch={false}
            onNavigate={onNavigate}
            className="ui-button ui-button--secondary"
          >
            {t('nextMonth')}
          </Link>
        )}
      </nav>
    </section>
  );
}
