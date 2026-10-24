import 'server-only';
import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  AUTH_REQUEST_TIMEOUT_MS,
} from '@/config/auth';
import type { AuthConfiguration } from '@/server/auth/configuration';
import type { Database } from '@/types/database';

export function authCookieName(configuration: AuthConfiguration) {
  const base = `sb-${new URL(configuration.supabaseUrl).hostname.split('.')[0]}-auth-token`;
  return new URL(configuration.appOrigin).protocol === 'https:'
    ? `__Host-${base}`
    : base;
}

export function authCookieOptions(configuration: AuthConfiguration) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: new URL(configuration.appOrigin).protocol === 'https:',
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
  };
}

// A new client per request, never shared across actors. Auth lives on the
// server: no browser client, localStorage token, or serialized session props.
export function createActorClient(
  configuration: AuthConfiguration,
  cookies: CookieMethodsServer,
) {
  return createServerClient<Database>(
    configuration.supabaseUrl,
    configuration.publicKey,
    {
      cookieOptions: {
        ...authCookieOptions(configuration),
        name: authCookieName(configuration),
      },
      cookies,
      global: {
        fetch: (input, init) => {
          const timeout = AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS);
          return fetch(input, {
            ...init,
            cache: 'no-store',
            signal: init?.signal
              ? AbortSignal.any([init.signal, timeout])
              : timeout,
          });
        },
      },
    },
  );
}

export type ActorClient = ReturnType<typeof createActorClient>;
