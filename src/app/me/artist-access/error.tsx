'use client';
import { AdminArtistsErrorScreen } from '@/components/admin-artists/AdminArtistsErrorScreen';
export default function Error({ reset }: { reset: () => void }) {
  return <AdminArtistsErrorScreen code="UNAVAILABLE" onRetry={reset} access />;
}
