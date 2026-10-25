'use client';
import { AdminSettingsErrorScreen } from '@/components/admin-settings/AdminSettingsErrorScreen';
export default function Error({ reset }: { reset: () => void }) {
  return <AdminSettingsErrorScreen code="UNAVAILABLE" onRetry={reset} />;
}
