import 'server-only';
import {
  onboardingInputSchema,
  ONBOARDING_STEP_PATHS,
  type OnboardingData,
  type OnboardingInput,
  type OnboardingResult,
  type OnboardingStep,
  type OnboardingSubmitResult,
} from '@/config/onboarding';
import { routes } from '@/config/routes';

export type OnboardingPort = {
  read(): Promise<OnboardingResult<OnboardingData>>;
  save(input: OnboardingInput): Promise<OnboardingResult<null>>;
};

export function resumeOnboarding(data: OnboardingData): string {
  if (data.profileCompleted) return routes.onboardingArtists;
  if (!data.fontSelected) return routes.onboardingFont;
  if (!data.callName) return routes.onboardingName;
  return routes.onboardingConsent;
}

export function onboardingStepRedirect(
  data: OnboardingData,
  step: OnboardingStep,
) {
  const requested = ONBOARDING_STEP_PATHS[step];
  if (step === 'font') return null;
  if (!data.fontSelected) return routes.onboardingFont;
  if (step === 'name') return null;
  if (!data.callName) return routes.onboardingName;
  if (step === 'consent') return null;
  const resumed = resumeOnboarding(data);
  return requested === resumed ? null : resumed;
}

export async function readOnboarding(
  port: OnboardingPort,
): Promise<OnboardingResult<OnboardingData>> {
  try {
    return await port.read();
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}

export async function saveOnboarding(
  port: OnboardingPort,
  input: unknown,
): Promise<OnboardingSubmitResult> {
  const parsed = onboardingInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const value = parsed.data;
  if (value.step === 'consent') {
    if (!value.ageConfirmed) return { ok: false, code: 'AGE_REQUIRED' };
    if (!value.termsAccepted || !value.privacyAccepted)
      return { ok: false, code: 'CONSENT_REQUIRED' };
    if (value.analyticsAccepted && !value.analyticsVersion)
      return { ok: false, code: 'CONSENT_REQUIRED' };
  }
  try {
    const saved = await port.save(value);
    if (!saved.ok) return saved;
    return {
      ok: true,
      next:
        value.step === 'font'
          ? routes.onboardingName
          : value.step === 'name'
            ? routes.onboardingConsent
            : routes.onboardingArtists,
    };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
