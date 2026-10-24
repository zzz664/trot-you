import 'server-only';
import type { CookieOptions } from '@supabase/ssr';
import type { NextResponse } from 'next/server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { createAuthPort } from '@/server/adapters/auth/supabase';
import {
  authCookieName,
  authCookieOptions,
  createActorClient,
} from '@/server/db/client';
import { getAuthConfiguration } from './configuration';

type Cookie = { name: string; value: string };
type CookieWrite = Cookie & { options: CookieOptions };

export function createAuthContext(
  incoming: Cookie[],
  onWrite?: (cookie: Cookie) => void,
) {
  const configuration = getAuthConfiguration();
  const current = new Map(
    incoming.map((cookie) => [cookie.name, cookie.value]),
  );
  const pending = new Map<string, CookieWrite>();
  const responseHeaders = new Headers(AUTH_PRIVATE_HEADERS);
  const write = (cookie: CookieWrite) => {
    current.set(cookie.name, cookie.value);
    pending.set(cookie.name, cookie);
    onWrite?.(cookie);
  };
  const client = configuration
    ? createActorClient(configuration, {
        getAll: () => Array.from(current, ([name, value]) => ({ name, value })),
        setAll: (updates, headers) => {
          updates.forEach(write);
          Object.entries(headers).forEach(([name, value]) =>
            responseHeaders.set(name, value),
          );
        },
      })
    : null;

  function clearCookies(session = true) {
    if (!configuration) return;
    const base = authCookieName(configuration);
    const names = session
      ? [base, `${base}-code-verifier`]
      : [`${base}-code-verifier`];
    for (const name of new Set([...current.keys(), ...names])) {
      if (
        !names.some(
          (prefix) =>
            name === prefix ||
            (/^\.\d+$/.test(name.slice(prefix.length)) &&
              name.startsWith(prefix)),
        )
      )
        continue;
      write({
        name,
        value: '',
        options: { ...authCookieOptions(configuration), maxAge: 0 },
      });
    }
  }

  return {
    configuration,
    client,
    port: client ? createAuthPort(client) : null,
    clearCookies,
    apply(response: NextResponse) {
      responseHeaders.forEach((value, name) =>
        response.headers.set(name, value),
      );
      pending.forEach(({ name, value, options }) =>
        response.cookies.set(name, value, options),
      );
      return response;
    },
  };
}
