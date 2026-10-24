import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/config/env.server';
import { AUTH_REQUEST_TIMEOUT_MS } from '@/config/auth';
import type { Database } from '@/types/database';

// Narrow, server-only media RPC capability. The verified actor is passed by
// the HTTP/service boundary; service credentials never authenticate a browser.
export function createMediaServiceClient() {
  const parsed = getServerEnv();
  if (
    !parsed.ok ||
    !parsed.data.NEXT_PUBLIC_SUPABASE_URL ||
    !parsed.data.SUPABASE_SERVICE_ROLE_KEY
  )
    return null;
  return createClient<Database>(
    parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    parsed.data.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
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
export type MediaServiceClient = NonNullable<
  ReturnType<typeof createMediaServiceClient>
>;
