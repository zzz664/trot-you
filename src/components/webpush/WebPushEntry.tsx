import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { routes } from '@/config/routes';

export async function WebPushEntry() {
  const t = await getTranslations('notifications');
  return (
    <Link
      href={routes.notifications}
      prefetch={false}
      className="ui-button ui-button--secondary"
    >
      {t('title')}
    </Link>
  );
}
