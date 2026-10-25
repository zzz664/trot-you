'use client';

import { BillingNoticesErrorScreen } from '@/components/billing-notices/BillingNoticesErrorScreen';

export default function Error({ retry }: { retry: () => void }) {
  return <BillingNoticesErrorScreen code="UNAVAILABLE" onRetry={retry} />;
}
