'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { MANAGEMENT_MAX_PAGE } from '@/config/subscription-management';

export function ManagementPagination({
  page,
  moreAvailable,
  onPage,
  disabled = false,
}: {
  page: number;
  moreAvailable: boolean;
  onPage: (page: number) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('subscriptions');
  return (
    <nav className="artist-pagination" aria-label={t('pagination')}>
      <p aria-current="page">{t('pageNumber', { page })}</p>
      <div className="ui-actions">
        <Button
          variant="secondary"
          disabled={disabled || page <= 1}
          onClick={() => onPage(page - 1)}
        >
          {t('previousPage')}
        </Button>
        <Button
          variant="secondary"
          disabled={disabled || !moreAvailable || page >= MANAGEMENT_MAX_PAGE}
          onClick={() => onPage(page + 1)}
        >
          {t('nextPage')}
        </Button>
      </div>
    </nav>
  );
}
