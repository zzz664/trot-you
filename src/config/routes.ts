export const routes = {
  home: '/',
  start: '/start',
  onboarding: '/onboarding',
  onboardingFont: '/onboarding/font',
  onboardingName: '/onboarding/name',
  onboardingConsent: '/onboarding/consent',
  onboardingArtists: '/onboarding/artists',
  onboardingSubmit: '/api/onboarding',
  restricted: '/restricted',
  artist: '/artist',
  admin: '/admin',
  authLogin: '/api/auth/login',
  authCallback: '/api/auth/callback',
  authLogout: '/api/auth/logout',
  uiPreview: '/ui-preview',
} as const;
export type AppRoute = (typeof routes)[keyof typeof routes];
