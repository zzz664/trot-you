'use client';
import { useFormatter, useTranslations } from 'next-intl';
import {
  ADMIN_SUBSCRIPTIONS,
  type AdminSubscriptionCurrent,
  type AdminSubscriptionPeriod,
} from '@/config/admin-subscriptions';
import styles from './admin-subscriptions.module.css';

export function AdminSubscriptionMetrics({
  current,
  period,
  compact = false,
}: {
  current: AdminSubscriptionCurrent;
  period: AdminSubscriptionPeriod;
  compact?: boolean;
}) {
  const t = useTranslations('adminSubscriptions');
  const format = useFormatter();
  return (
    <div className={styles.stack}>
      <section className={styles.stack} aria-label={t('currentTitle')}>
        <h3>{t('currentTitle')}</h3>
        <dl className={styles.metrics} data-admin-subscriptions-current>
          {Object.entries(current)
            .filter(
              ([key]) =>
                !compact ||
                key === 'total_subscriptions' ||
                key === 'subscribers',
            )
            .map(([key, count]) => (
              <div key={key} data-admin-subscriptions-metric={key}>
                <dt>{t(`current.${key}`)}</dt>
                <dd>{format.number(count)}</dd>
              </div>
            ))}
        </dl>
      </section>
      <section className={styles.stack} aria-label={t('periodTitle')}>
        <h3>{t('periodTitle')}</h3>
        <dl className={styles.metrics} data-admin-subscriptions-period>
          {Object.entries(period)
            .filter(
              ([key]) =>
                !compact ||
                key === 'new_subscriptions' ||
                key === 'cancellations' ||
                key === 'renewal_rate',
            )
            .map(([key, count]) => (
              <div key={key} data-admin-subscriptions-metric={key}>
                <dt>{t(`period.${key}`)}</dt>
                <dd>
                  {key === 'renewal_rate'
                    ? count === null
                      ? t('renewalNoData')
                      : t('renewalRatio', {
                          rate: format.number(count, {
                            maximumFractionDigits:
                              ADMIN_SUBSCRIPTIONS.rateDecimalPlaces,
                          }),
                          paid: format.number(period.renewal_paid),
                          due: format.number(period.renewal_due),
                        })
                    : format.number(count ?? 0)}
                </dd>
              </div>
            ))}
        </dl>
      </section>
    </div>
  );
}
