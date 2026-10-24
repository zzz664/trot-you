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
  checkout: '/checkout',
  checkoutSubmit: '/api/checkout',
  checkoutCancel: '/api/checkout/cancel',
  checkoutReturn: '/api/checkout/return',
  enrollmentStart: '/api/checkout/enrollment/start',
  enrollmentConfirm: '/api/checkout/enrollment/confirm',
  enrollmentCancel: '/api/checkout/enrollment/cancel',
  enrollmentReconcile: '/api/checkout/enrollment/reconcile',
  enrollmentStatus: '/api/checkout/enrollment/status',
  enrollmentComplete: '/checkout/complete',
  chargeRenewals: '/api/cron/charge-renewals',
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

export function checkoutPath(slug: string) {
  return `${routes.checkout}/${encodeURIComponent(slug)}`;
}

export function enrollmentCompletePath(sessionId: string) {
  return `${routes.enrollmentComplete}?session=${encodeURIComponent(sessionId)}`;
}
