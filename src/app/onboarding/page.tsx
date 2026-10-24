import { SessionPage } from '@/components/auth/SessionPage';
import { routes } from '@/config/routes';

export default function OnboardingPage() {
  return <SessionPage path={routes.onboarding} />;
}
