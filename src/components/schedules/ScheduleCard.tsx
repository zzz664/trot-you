'use client';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import {
  SCHEDULES,
  type ScheduleEvent,
  type AdminSchedule,
} from '@/config/schedules';
import { scheduleDetailPath, adminSchedulePath } from '@/config/routes';
import { Card } from '@/components/ui/Card';
export function ScheduleCard({
  event,
  month,
  admin = false,
  onNavigate,
}: {
  event: ScheduleEvent | AdminSchedule;
  month: string;
  admin?: boolean;
  onNavigate: () => void;
}) {
  const t = useTranslations('schedules');
  const format = useFormatter();
  const date = (value: string) =>
    format.dateTime(new Date(value), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: SCHEDULES.timeZone,
    });
  return (
    <Card title={event.title}>
      <p>
        {event.artist_name} · {t(`types.${event.type}`)}
      </p>
      <p>
        {date(event.starts_at)}
        {event.ends_at ? ` – ${date(event.ends_at)}` : ''}
      </p>
      <p>{event.place_name ?? t('placeUnknown')}</p>
      {admin && 'status' in event && <p>{t(`statuses.${event.status}`)}</p>}
      <Link
        href={
          admin
            ? adminSchedulePath(event.id)
            : scheduleDetailPath(event.id, month)
        }
        prefetch={false}
        onNavigate={onNavigate}
        className="ui-button ui-button--secondary"
      >
        {t(admin ? 'edit' : 'openDetail', { title: event.title })}
      </Link>
    </Card>
  );
}
