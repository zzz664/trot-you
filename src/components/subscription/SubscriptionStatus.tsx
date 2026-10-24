'use client';

import { useTranslations } from 'next-intl';
import type { SubscriptionSummary } from '@/config/subscription-management';
import { managementDate } from './format';

export function SubscriptionStatus({ data }: { data: SubscriptionSummary }) {
  const t = useTranslations('subscriptions');
  return (
    <div className="onboarding-stack">
      <p role="status">{t(`statuses.${data.status}`)}</p>
      <p>
        {data.current_period_end
          ? t('paidUntil', { date: managementDate(data.current_period_end) })
          : t('noPaidPeriod')}
      </p>
      <p>
        {data.next_billing_at
          ? t('nextBilling', { date: managementDate(data.next_billing_at) })
          : t('noNextBilling')}
      </p>
      <p>{t(data.has_access ? 'accessAvailable' : 'accessUnavailable')}</p>
      {data.status === 'grace' && <p>{t('graceNotice')}</p>}
      {data.has_unresolved_charge && (
        <p className="ui-hint">{t('renewalUncertain')}</p>
      )}
    </div>
  );
}
