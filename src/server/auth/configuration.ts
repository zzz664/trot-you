import 'server-only';
import { getAuthEnv } from '@/config/env.server';

export type AuthConfiguration = {
  appOrigin: string;
  supabaseUrl: string;
  publicKey: string;
};

// Authentication is actor-scoped. A service-role key is neither required nor
// projected into this capability; its presence never changes authorization.
export function getAuthConfiguration(): AuthConfiguration | null {
  const parsed = getAuthEnv();
  if (!parsed.ok) return null;
  const env = parsed.data;
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    return null;
  return {
    appOrigin: new URL(env.NEXT_PUBLIC_APP_URL).origin,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    publicKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}
