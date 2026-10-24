'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { routes } from '@/config/routes';

export function ReconciliationEntry() {
  const router = useRouter();
  const t = useTranslations('reconciliation');
  return (
    <Button
      variant="secondary"
      onClick={() => router.push(routes.adminReconciliation)}
    >
      {t('title')}
    </Button>
  );
}
