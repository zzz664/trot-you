'use client';

import { ManagementErrorScreen } from '@/components/subscription/ManagementErrorScreen';

export default function Error({ reset }: { reset: () => void }) {
  return <ManagementErrorScreen code="UNAVAILABLE" onRetry={reset} />;
}
