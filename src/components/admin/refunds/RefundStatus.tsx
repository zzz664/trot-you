'use client';

import { useTranslations } from 'next-intl';
import type { RefundRequest } from '@/config/subscription-management';
import {
  managementAmount,
  managementDate,
} from '@/components/subscription/format';

export function RefundStatus({ data }: { data: RefundRequest }) {
  const t = useTranslations('refunds');
  return (
    <div className="onboarding-stack">
      <p role="status">{t(`statuses.${data.status}`)}</p>
      <p>{t('amount', { amount: managementAmount(data.amount_krw) })}</p>
      <p>{t('createdAt', { date: managementDate(data.requested_at) })}</p>
      <p className="artist-copy">{t('reason', { reason: data.reason })}</p>
      {data.decision_reason && (
        <p className="artist-copy">
          {t('decisionReason', { reason: data.decision_reason })}
        </p>
      )}
      {['inflight', 'unknown'].includes(data.status) && (
        <p>{t('unknownNotice')}</p>
      )}
      {data.requires_manual_review && <p>{t('manualReview')}</p>}
    </div>
  );
}
