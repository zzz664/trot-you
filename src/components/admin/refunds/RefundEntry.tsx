'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { routes } from '@/config/routes';

export function RefundEntry() {
  const router = useRouter();
  const t = useTranslations('refunds');
  return (
    <Button
      variant="secondary"
      onClick={() => router.push(routes.adminRefunds)}
    >
      {t('title')}
    </Button>
  );
}
