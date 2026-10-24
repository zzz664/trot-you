'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  managementAmount,
  managementDate,
} from '@/components/subscription/format';
import {
  RECONCILIATION_ADMIN_MAX_PAGE,
  type ReconciliationAdminList,
} from '@/config/reconciliation-admin';
import { adminReconciliationPath, routes } from '@/config/routes';

export function ReconciliationScreen({
  data,
}: {
  data: ReconciliationAdminList;
}) {
  const router = useRouter();
  const t = useTranslations('reconciliation');
  return (
    <main className="app-shell onboarding-shell">
      <nav aria-label={t('navigation')}>
        <BackButton fallbackHref={routes.admin} />
      </nav>
      <header className="onboarding-stack">
        <h1>{t('title')}</h1>
        <p>{t('description')}</p>
        <p>{t('readOnly')}</p>
        <p>{t('timeZone')}</p>
      </header>
      {data.cases.length === 0 ? (
        <Card title={t('emptyTitle')}>
          <p>{t('emptyDescription')}</p>
        </Card>
      ) : (
        <ul className="artist-list">
          {data.cases.map((item) => (
            <li key={item.id}>
              <Card title={t(`kinds.${item.kind}`)}>
                <div className="onboarding-stack">
                  <p role="status">{t(`statuses.${item.status}`)}</p>
                  <p>
                    {t('provider', {
                      provider: t(`providers.${item.provider}`),
                      environment: t(`environments.${item.environment}`),
                    })}
                  </p>
                  <p>
                    {t('amount', { amount: managementAmount(item.amount_krw) })}
                  </p>
                  <p>{t('queryAttempts', { count: item.query_attempts })}</p>
                  <p>
                    {t('createdAt', { date: managementDate(item.created_at) })}
                  </p>
                  <p>
                    {t('updatedAt', { date: managementDate(item.updated_at) })}
                  </p>
                  {item.reason && <p>{t(`reasons.${item.reason}`)}</p>}
                  {item.status !== 'processed' && <p>{t('unconfirmed')}</p>}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <nav className="artist-pagination" aria-label={t('pagination')}>
        <p aria-current="page">{t('pageNumber', { page: data.page })}</p>
        <div className="ui-actions">
          <Button
            variant="secondary"
            disabled={data.page <= 1}
            onClick={() => router.push(adminReconciliationPath(data.page - 1))}
          >
            {t('previousPage')}
          </Button>
          <Button
            variant="secondary"
            disabled={
              !data.has_more || data.page >= RECONCILIATION_ADMIN_MAX_PAGE
            }
            onClick={() => router.push(adminReconciliationPath(data.page + 1))}
          >
            {t('nextPage')}
          </Button>
        </div>
      </nav>
      <Button variant="secondary" onClick={() => router.refresh()}>
        {t('refresh')}
      </Button>
    </main>
  );
}
