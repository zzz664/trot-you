import { ProfileOnboarding } from './ProfileOnboarding';
import { OnboardingEntry } from './OnboardingEntry';
import { getOnboardingPage } from '@/server/onboarding/page';
import { resumeOnboarding } from '@/server/services/onboarding/profile';
import type { OnboardingStep } from '@/config/onboarding';

export async function OnboardingScreen({ step }: { step?: OnboardingStep }) {
  const result = await getOnboardingPage(step);
  if (!result.ok) return <OnboardingEntry error={result.code} />;
  if (!step) return <OnboardingEntry next={resumeOnboarding(result.data)} />;
  return (
    <ProfileOnboarding
      key={`${step}:${result.data.fontScale}:${result.data.terms?.version}:${result.data.privacy?.version}:${result.data.analytics?.version}`}
      step={step}
      data={result.data}
    />
  );
}
