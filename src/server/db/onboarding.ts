import 'server-only';
import type { ActorClient } from './client';
import type {
  OnboardingData,
  OnboardingError,
  OnboardingInput,
  OnboardingResult,
  Policy,
} from '@/config/onboarding';
import type { OnboardingPort } from '@/server/services/onboarding/profile';

// Only exact controlled SQL errors cross the boundary. Never leak SQL, names,
// profile IDs, provider messages or policy drafts in error bodies/logs.
function databaseError(message: string): OnboardingResult<never> {
  const errors: Record<string, OnboardingError> = {
    ONBOARDING_SETUP_NOT_READY: 'SETUP_NOT_READY',
    ONBOARDING_NAME_INVALID: 'NAME_INVALID',
    ONBOARDING_NAME_FORBIDDEN: 'NAME_FORBIDDEN',
    ONBOARDING_AGE_REQUIRED: 'AGE_REQUIRED',
    ONBOARDING_CONSENT_REQUIRED: 'CONSENT_REQUIRED',
    ONBOARDING_POLICY_CHANGED: 'POLICY_CHANGED',
    ONBOARDING_ACTOR_FORBIDDEN: 'FORBIDDEN',
    ONBOARDING_ALREADY_COMPLETED: 'FORBIDDEN',
    ONBOARDING_FONT_REQUIRED: 'INVALID_INPUT',
    ONBOARDING_FONT_INVALID: 'INVALID_INPUT',
    ONBOARDING_ANALYTICS_UNAVAILABLE: 'POLICY_CHANGED',
    ONBOARDING_INVALID_INPUT: 'INVALID_INPUT',
  };
  return {
    ok: false,
    code: Object.hasOwn(errors, message) ? errors[message]! : 'UNAVAILABLE',
  };
}
function policy(
  version: string | null,
  title: string | null,
  body: string | null,
): Policy | null {
  return version && title?.trim() && body?.trim()
    ? { version, title, body }
    : null;
}

export function createOnboardingPort(client: ActorClient): OnboardingPort {
  return {
    async read(): Promise<OnboardingResult<OnboardingData>> {
      const { data, error } = await client.rpc('onboarding_get_state').single();
      if (error) return databaseError(error.message);
      if (!data) return { ok: false, code: 'UNAVAILABLE' };
      return {
        ok: true,
        data: {
          fontScale: data.font_scale,
          fontSelected: data.font_selected_at !== null,
          callName: data.call_name,
          nameMin: data.call_name_min,
          nameMax: data.call_name_max,
          nameReady: data.name_policy_ready,
          profileCompleted: data.profile_completed_at !== null,
          terms: policy(data.terms_version, data.terms_title, data.terms_body),
          privacy: policy(
            data.privacy_version,
            data.privacy_title,
            data.privacy_body,
          ),
          analytics: data.analytics_available
            ? policy(
                data.analytics_version,
                data.analytics_title,
                data.analytics_body,
              )
            : null,
        },
      };
    },
    async save(input: OnboardingInput): Promise<OnboardingResult<null>> {
      const result =
        input.step === 'font'
          ? await client.rpc('onboarding_save_font', {
              p_font_scale: input.fontScale,
            })
          : input.step === 'name'
            ? await client.rpc('onboarding_save_name', {
                p_call_name: input.callName,
              })
            : await client.rpc('onboarding_complete_profile', {
                p_age_over_14: input.ageConfirmed,
                p_terms_accepted: input.termsAccepted,
                p_terms_version: input.termsVersion,
                p_privacy_accepted: input.privacyAccepted,
                p_privacy_version: input.privacyVersion,
                p_analytics_granted: input.analyticsAccepted,
                ...(input.analyticsVersion
                  ? { p_analytics_version: input.analyticsVersion }
                  : {}),
              });
      return result.error
        ? databaseError(result.error.message)
        : { ok: true, data: null };
    },
  };
}

export async function readProfileFont(client: ActorClient, subject: string) {
  return client
    .from('profiles')
    .select('font_scale')
    .eq('id', subject)
    .maybeSingle();
}
