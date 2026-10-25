import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { routes } from '@/config/routes';
export async function CommunityEntry() {
  const t = await getTranslations('communityPosts');
  return (
    <Card title={t('title')}>
      <p>{t('entryDescription')}</p>
      <Link
        href={routes.artists}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {t('entryOpen')}
      </Link>
    </Card>
  );
}
