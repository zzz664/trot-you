import { z } from 'zod';
import type { FontScale } from './design-tokens';
import { routes } from './routes';

export const ONBOARDING_BODY_LIMIT = 2048;
export const ONBOARDING_REQUEST_TIMEOUT_MS = 15_000;
export const FONT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
export const ONBOARDING_FONT_SCALES = ['normal', 'large', 'xlarge'] as const;
export const ONBOARDING_PATHS = [
  routes.onboarding,
  routes.onboardingFont,
  routes.onboardingName,
  routes.onboardingConsent,
  routes.onboardingArtists,
] as const;
export const ONBOARDING_STEP_PATHS = {
  font: routes.onboardingFont,
  name: routes.onboardingName,
  consent: routes.onboardingConsent,
  artists: routes.onboardingArtists,
} as const;
export type OnboardingStep = keyof typeof ONBOARDING_STEP_PATHS;
export type Policy = { version: string; title: string; body: string };
export type OnboardingData = {
  fontScale: FontScale;
  fontSelected: boolean;
  callName: string | null;
  nameMin: number | null;
  nameMax: number | null;
  nameReady: boolean;
  profileCompleted: boolean;
  terms: Policy | null;
  privacy: Policy | null;
  analytics: Policy | null;
};
export const onboardingInputSchema = z.discriminatedUnion('step', [
  z.strictObject({
    step: z.literal('font'),
    fontScale: z.enum(ONBOARDING_FONT_SCALES),
  }),
  z.strictObject({
    step: z.literal('name'),
    callName: z.string().min(1).max(ONBOARDING_BODY_LIMIT),
  }),
  z.strictObject({
    step: z.literal('consent'),
    ageConfirmed: z.boolean(),
    termsVersion: z.uuid(),
    privacyVersion: z.uuid(),
    termsAccepted: z.boolean(),
    privacyAccepted: z.boolean(),
    analyticsAccepted: z.boolean(),
    analyticsVersion: z.uuid().nullable(),
  }),
]);
export type OnboardingInput = z.output<typeof onboardingInputSchema>;
export const ONBOARDING_ERROR_STATUS = {
  SETUP_NOT_READY: 503,
  INVALID_INPUT: 400,
  NAME_INVALID: 400,
  NAME_FORBIDDEN: 400,
  AGE_REQUIRED: 400,
  CONSENT_REQUIRED: 400,
  POLICY_CHANGED: 409,
  FORBIDDEN: 403,
  UNAUTHENTICATED: 401,
  UNAVAILABLE: 503,
} as const;
export type OnboardingError = keyof typeof ONBOARDING_ERROR_STATUS;
export type OnboardingResult<T> =
  { ok: true; data: T } | { ok: false; code: OnboardingError };
export type OnboardingSubmitResult =
  { ok: true; next: string } | { ok: false; code: OnboardingError };
