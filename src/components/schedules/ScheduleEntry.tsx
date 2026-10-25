import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { routes } from '@/config/routes';
import { Card } from '@/components/ui/Card';
export async function ScheduleEntry({ admin = false }: { admin?: boolean }) {
  const t = await getTranslations('schedules');
  return (
    <Card title={t(admin ? 'adminTitle' : 'title')}>
      <p>{t(admin ? 'adminDescription' : 'description')}</p>
      <Link
        href={admin ? routes.adminSchedules : routes.schedules}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {t(admin ? 'adminEntryOpen' : 'entryOpen')}
      </Link>
    </Card>
  );
}
