'use client';
import { InstallErrorScreen } from '@/components/onboarding/InstallErrorScreen';
export default function InstallError({ reset }: { reset: () => void }) {
  return <InstallErrorScreen code="UNAVAILABLE" onRetry={reset} />;
}
