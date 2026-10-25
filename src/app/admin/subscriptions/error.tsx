'use client';
import { AdminSubscriptionsErrorScreen } from '@/components/admin-subscriptions/AdminSubscriptionsErrorScreen';
export default function Error({ reset }: { reset: () => void }) {
  return <AdminSubscriptionsErrorScreen code="UNAVAILABLE" onRetry={reset} />;
}
