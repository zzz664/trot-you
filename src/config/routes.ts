export const routes = {
  home: '/',
  start: '/start',
  onboarding: '/onboarding',
  restricted: '/restricted',
  artist: '/artist',
  admin: '/admin',
  authLogin: '/api/auth/login',
  authCallback: '/api/auth/callback',
  authLogout: '/api/auth/logout',
  uiPreview: '/ui-preview',
} as const;
export type AppRoute = (typeof routes)[keyof typeof routes];
