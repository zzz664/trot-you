'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ManagementPagination } from '@/components/subscription/ManagementPagination';
import type { AdminRefundList } from '@/config/subscription-management';
import { adminRefundListPath, adminRefundPath, routes } from '@/config/routes';
import { RefundStatus } from './RefundStatus';

export function RefundsScreen({ data }: { data: AdminRefundList }) {
  const router = useRouter();
  const t = useTranslations('refunds');
  return (
    <main className="app-shell onboarding-shell">
      <nav aria-label={t('navigation')}>
        <BackButton fallbackHref={routes.admin} />
      </nav>
      <header className="onboarding-stack">
        <h1>{t('title')}</h1>
        <p>{t('description')}</p>
      </header>
      {!data.policy && <p>{t('policyUnavailable')}</p>}
      {data.requests.length === 0 ? (
        <Card title={t('emptyTitle')}>
          <p>{t('emptyDescription')}</p>
        </Card>
      ) : (
        <ul className="artist-list">
          {data.requests.map((request) => (
            <li key={request.id}>
              <Card title={request.artist_name}>
                <RefundStatus data={request} />
                <Button
                  onClick={() => router.push(adminRefundPath(request.id))}
                >
                  {t('open', { name: request.artist_name })}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <ManagementPagination
        page={data.page}
        moreAvailable={data.more_available}
        onPage={(page) => router.push(adminRefundListPath(page))}
      />
      <Button variant="secondary" onClick={() => router.refresh()}>
        {t('refresh')}
      </Button>
    </main>
  );
}
