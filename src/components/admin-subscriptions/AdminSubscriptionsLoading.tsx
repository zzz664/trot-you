'use client';
import { useTranslations } from 'next-intl';
import { Loading } from '@/components/ui/Loading';

export function AdminSubscriptionsLoading() {
  const t = useTranslations('adminSubscriptions');
  return (
    <main className="app-shell onboarding-shell">
      <h1>{t('title')}</h1>
      <Loading label={t('loading')} />
    </main>
  );
}
