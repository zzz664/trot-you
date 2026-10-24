import 'server-only';
import { AUTH_RETURN_PATHS } from '@/config/auth';
import { routes } from '@/config/routes';
import type { AuthProfile } from '@/server/db/auth-profile';
import type { AuthState } from './session';

export function safeReturnPath(value: unknown): string {
  return typeof value === 'string' &&
    AUTH_RETURN_PATHS.some((path) => path === value)
    ? value
    : routes.home;
}

export function isRestricted(profile: AuthProfile, now = Date.now()) {
  if (!profile.is_restricted) return false;
  if (!profile.restricted_until) return true;
  const expiry = Date.parse(profile.restricted_until);
  return !Number.isFinite(expiry) || expiry > now;
}

export function landingPath(profile: AuthProfile, now = Date.now()): string {
  if (isRestricted(profile, now)) return routes.restricted;
  if (!profile.onboarding_completed_at) return routes.onboarding;
  if (profile.role === 'admin') return routes.admin;
  if (profile.role === 'artist') return routes.artist;
  return routes.home;
}

// Auth return paths never override the authoritative database state. This
// feature has one session-only landing per role; future domain routes must add
// explicit authorization here and their own data-access guard.
export function authorizedReturnPath(profile: AuthProfile, requested: unknown) {
  const landing = landingPath(profile);
  return safeReturnPath(requested) === landing
    ? safeReturnPath(requested)
    : landing;
}

export function pageRedirect(
  state: AuthState,
  pathname: string,
): string | null {
  if (state.status === 'authenticated') {
    const target = landingPath(state.profile);
    return pathname === target ? null : target;
  }
  if (pathname === routes.start) return null;
  return `${routes.start}?next=${encodeURIComponent(safeReturnPath(pathname))}`;
}

export function isSameOriginPost(
  origin: string | null,
  configuredOrigin: string,
) {
  return origin !== null && origin === configuredOrigin;
}
