import { z } from 'zod';
import { LOCAL_APP_URL } from './constants';

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//.test(value), 'Expected an HTTP(S) URL')
    .default(LOCAL_APP_URL),
});

// An explicit allowlist prevents unrelated server secrets from being exported.
export function getPublicEnv() {
  return publicEnvSchema.parse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
}
