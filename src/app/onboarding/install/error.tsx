'use client';

import { ArtistErrorScreen } from '@/components/artists/ArtistErrorScreen';

export default function ArtistError({ reset }: { reset: () => void }) {
  return <ArtistErrorScreen code="UNAVAILABLE" onRetry={reset} onboarding />;
}
