import { routes } from './routes';

export const AUTH_PROVIDER = 'kakao';
export const AUTH_REQUEST_TIMEOUT_MS = 10_000;
export const AUTH_CODE_MAX_LENGTH = 2048;
export const AUTH_REDIRECT_STATUS = 303;
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const AUTH_RETURN_PATHS = [
  routes.home,
  routes.artist,
  routes.admin,
  routes.onboarding,
] as const;
export const AUTH_PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
  'Referrer-Policy': 'no-referrer',
} as const;
export const AUTH_START_MESSAGES = [
  'callback_failed',
  'login_failed',
  'signed_out',
  'logout_incomplete',
] as const;
export type AuthStartMessage = (typeof AUTH_START_MESSAGES)[number];
