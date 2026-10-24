import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/config/env.server';
import { CHECKOUT_REQUEST_TIMEOUT_MS } from '@/config/checkout';
import type { Database } from '@/types/database';

// Trusted capability only for private intent RPCs. This does not authenticate
// a user: HTTP/page boundaries verify the actor separately with the actor client.
export function createCheckoutServiceClient() {
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
          const timeout = AbortSignal.timeout(CHECKOUT_REQUEST_TIMEOUT_MS);
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
export type CheckoutServiceClient = NonNullable<
  ReturnType<typeof createCheckoutServiceClient>
>;
