export const routes = {
  home: '/',
  start: '/start',
  onboarding: '/onboarding',
  onboardingFont: '/onboarding/font',
  onboardingName: '/onboarding/name',
  onboardingConsent: '/onboarding/consent',
  onboardingArtists: '/onboarding/artists',
  onboardingInstall: '/onboarding/install',
  artists: '/artists',
  artistSelectionSubmit: '/api/onboarding/artist',
  onboardingSubmit: '/api/onboarding',
  installSubmit: '/api/onboarding/install',
  restricted: '/restricted',
  artist: '/artist',
  admin: '/admin',
  authLogin: '/api/auth/login',
  authCallback: '/api/auth/callback',
  authLogout: '/api/auth/logout',
  uiPreview: '/ui-preview',
} as const;
export type AppRoute = (typeof routes)[keyof typeof routes];

export function artistPreviewPath(slug: string) {
  return `${routes.artists}/${encodeURIComponent(slug)}`;
}
export function artistCatalogPath(page: number, onboarding = false) {
  const base = onboarding ? routes.onboardingArtists : routes.artists;
  return page > 1 ? `${base}?page=${page}` : base;
}
