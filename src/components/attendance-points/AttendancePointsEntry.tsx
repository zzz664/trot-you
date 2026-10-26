import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { routes } from '@/config/routes';
export async function AttendancePointsEntry() {
  const t = await getTranslations('attendancePoints');
  return (
    <Card title={t('entryTitle')}>
      <p>{t('entryDescription')}</p>
      <Link
        href={routes.points}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {t('entryOpen')}
      </Link>
    </Card>
  );
}
