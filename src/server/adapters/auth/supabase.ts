import 'server-only';
import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { AUTH_PROVIDER } from '@/config/auth';
import { failure, success } from '@/lib/result';
import { readAuthProfile } from '@/server/db/auth-profile';
import type { ActorClient } from '@/server/db/client';
import type { AuthPort } from '@/server/services/auth/session';

export function createAuthPort(client: ActorClient): AuthPort {
  return {
    async verifySubject() {
      try {
        const { data, error } = await client.auth.getClaims();
        if (error)
          return isAuthSessionMissingError(error)
            ? success(null)
            : failure('INTERNAL');
        if (!data?.claims.sub) return success(null);
        // Never trust cookie session.user or user_metadata. A current Auth lookup
        // additionally detects removed/disabled users; database role is separate.
        const current = await client.auth.getUser();
        if (current.error || current.data.user?.id !== data.claims.sub)
          return failure('INTERNAL');
        return success(data.claims.sub);
      } catch {
        return failure('INTERNAL');
      }
    },
    async readProfile(subject) {
      try {
        const { data, error } = await readAuthProfile(client, subject);
        return error || !data ? failure('INTERNAL') : success(data);
      } catch {
        return failure('INTERNAL');
      }
    },
    async beginLogin(callback) {
      try {
        const { data, error } = await client.auth.signInWithOAuth({
          provider: AUTH_PROVIDER,
          options: { redirectTo: callback, skipBrowserRedirect: true },
        });
        return error || !data.url ? failure('INTERNAL') : success(data.url);
      } catch {
        return failure('INTERNAL');
      }
    },
    async exchangeCode(code) {
      try {
        const { error } = await client.auth.exchangeCodeForSession(code);
        return error ? failure('UNAUTHENTICATED') : success(null);
      } catch {
        return failure('UNAUTHENTICATED');
      }
    },
    async signOut() {
      try {
        const { error } = await client.auth.signOut({ scope: 'local' });
        return error ? failure('INTERNAL') : success(null);
      } catch {
        return failure('INTERNAL');
      }
    },
  };
}
