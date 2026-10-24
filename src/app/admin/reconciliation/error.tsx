'use client';

import { ReconciliationErrorScreen } from '@/components/admin/reconciliation/ReconciliationErrorScreen';

export default function Error({ reset }: { reset: () => void }) {
  return <ReconciliationErrorScreen code="UNAVAILABLE" onRetry={reset} />;
}
