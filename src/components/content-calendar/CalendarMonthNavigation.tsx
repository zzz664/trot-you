'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { scheduleMonthShift } from '@/lib/schedule-view';
import {
  adminContentCalendarPath,
  artistContentCalendarPath,
} from '@/config/routes';
import styles from './content-calendar.module.css';
export function CalendarMonthNavigation({
  month,
  artistId,
  slug,
  onNavigate,
}: {
  month: string;
  artistId?: string;
  slug?: string;
  onNavigate: () => void;
}) {
  const t = useTranslations('contentCalendar');
  const [year, number] = month.split('-');
  const previous = scheduleMonthShift(month, -1);
  const next = scheduleMonthShift(month, 1);
  const path = (value: string) =>
    slug
      ? artistContentCalendarPath(slug, value)
      : adminContentCalendarPath(value, artistId);
  return (
    <section className={styles.stack}>
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
