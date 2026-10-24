import { InstallOnboarding } from '@/components/onboarding/InstallOnboarding';
import { InstallErrorScreen } from '@/components/onboarding/InstallErrorScreen';
import { getInstallPage } from '@/server/install/page';

export default async function OnboardingInstallPage() {
  const result = await getInstallPage();
  if (!result.ok) return <InstallErrorScreen code={result.code} />;
  // Fresh server evidence invalidates stale browser choices and pending UI.
  const key = JSON.stringify([
    result.data.choice,
    result.data.acknowledgedAt,
    result.data.installationSelfReportedAt,
  ]);
  return <InstallOnboarding key={key} data={result.data} />;
}
