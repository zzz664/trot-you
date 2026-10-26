import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { routes } from '@/config/routes';
export async function ModerationEntry({ admin = false }: { admin?: boolean }) {
  const t = await getTranslations('communityModeration');
  return (
    <Card title={t(admin ? 'adminTitle' : 'inboxTitle')}>
      <p>{t(admin ? 'adminDescription' : 'inboxDescription')}</p>
      <Link
        href={admin ? routes.adminModeration : routes.communityReports}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {t(admin ? 'adminEntry' : 'inboxEntry')}
      </Link>
    </Card>
  );
}
