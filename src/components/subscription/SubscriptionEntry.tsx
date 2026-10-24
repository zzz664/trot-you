'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { routes } from '@/config/routes';

export function SubscriptionEntry() {
  const router = useRouter();
  const t = useTranslations('subscriptions');
  return (
    <Button
      variant="secondary"
      onClick={() => router.push(routes.subscriptions)}
    >
      {t('title')}
    </Button>
  );
}
