import { ProfileOnboarding } from './ProfileOnboarding';
import { OnboardingEntry } from './OnboardingEntry';
import { getOnboardingPage } from '@/server/onboarding/page';
import { resumeOnboarding } from '@/server/services/onboarding/profile';
import type { OnboardingStep } from '@/config/onboarding';

export async function OnboardingScreen({
  step,
}: {
  step?: Exclude<OnboardingStep, 'artists'>;
}) {
  const result = await getOnboardingPage(step);
  if (!result.ok) return <OnboardingEntry error={result.code} />;
  if (!step) return <OnboardingEntry next={resumeOnboarding(result.data)} />;
  // Only consent choices are bound to document versions. Refreshing legal
  // setup must not erase an unsaved name or font preview on another step.
  const consentVersions =
    step === 'consent'
      ? `${result.data.terms?.version}:${result.data.privacy?.version}:${result.data.analytics?.version}`
      : '';
  return (
    <ProfileOnboarding
      key={`${step}:${result.data.fontScale}:${consentVersions}`}
      step={step}
      data={result.data}
    />
  );
}
