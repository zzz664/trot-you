import { z } from 'zod';
import { LOCAL_APP_URL } from './constants';

const emptyAsMissing = (value: unknown) => (value === '' ? undefined : value);
export const optionalEnvValue = <T extends z.ZodType>(schema: T) =>
  z.preprocess(emptyAsMissing, schema.optional());

export const originSchema = z
  .string()
  .url()
  .refine((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return (
      (url.protocol === 'https:' || (url.protocol === 'http:' && isLocal)) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/'
    );
  }, 'Expected an HTTPS origin (HTTP is allowed only on loopback)');

export function hasSupabaseKeyRole(
  value: string,
  role: 'anon' | 'service_role',
) {
  try {
    const parts = value.split('.');
    const payloadIndex = 1;
    const jwtParts = 3;
    if (parts.length !== jwtParts || !parts[payloadIndex]) return false;
    const payload: unknown = JSON.parse(
      atob(parts[payloadIndex].replace(/-/g, '+').replace(/_/g, '/')),
    );
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'role' in payload &&
      payload.role === role
    );
  } catch {
    return false;
  }
}

// Explicit public allowlist; unknown fields never survive parsing. Key checks
// classify public credentials only; they do not authenticate an issued key.
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.preprocess(
    emptyAsMissing,
    originSchema.default(LOCAL_APP_URL),
  ),
  NEXT_PUBLIC_SUPABASE_URL: optionalEnvValue(originSchema),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalEnvValue(
    z
      .string()
      .refine(
        (value) =>
          /^sb_publishable_[A-Za-z0-9_-]+$/.test(value) ||
          hasSupabaseKeyRole(value, 'anon'),
        'Expected a public Supabase key',
      ),
  ),
  NEXT_PUBLIC_TOSS_CLIENT_KEY: optionalEnvValue(
    z.string().regex(/^(test|live)_ck_[A-Za-z0-9_-]+$/),
  ),
});

export type PublicEnv = z.output<typeof publicEnvSchema>;

export function getPublicEnv(): PublicEnv {
  // Next.js requires static access for build-time NEXT_PUBLIC_* substitution.
  const result = publicEnvSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_TOSS_CLIENT_KEY: process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY,
  });
  if (!result.success)
    throw new Error('Invalid public environment configuration');
  return result.data;
}

/** Build-time substitution only; never enables a worker in Next dev. */
export function isProductionBuild() {
  return process.env.NODE_ENV === 'production';
}
