import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/ui/Notice';

export default async function HomePage() {
  const t = await getTranslations('foundation');
  return (
    <main className="app-shell">
      <p className="text-brand">{t('eyebrow')}</p>
      <h1>{t('title')}</h1>
      <p>{t('description')}</p>
      <Notice title={t('statusTitle')} description={t('statusDescription')} />
    </main>
  );
}
