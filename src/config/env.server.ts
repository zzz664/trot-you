import 'server-only';
import { z } from 'zod';
import { KAKAOPAY_TEST_CIDS } from './integrations';
import {
  RENEWAL_CRON_SECRET_MIN_LENGTH,
  RENEWAL_CRON_SECRET_MAX_LENGTH,
} from './renewal';
import {
  parseEnrollmentTestRuntime,
  parseRenewalTestRuntime,
} from './enrollment-test-runtime';
import {
  PAYMENT_VAULT_KEY_PATTERN,
  PAYMENT_VAULT_KEY_VERSION_PATTERN,
  PAYMENT_VAULT_KEY_VERSION_MAX_LENGTH,
} from './enrollment-provider';
import { failure, success, type Result } from '@/lib/result';
import { hasSupabaseKeyRole, optionalEnvValue, publicEnvSchema } from './env';

const secretSchema = z.string().min(1).regex(/^\S+$/);
const flagSchema = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');
const serverEnvSchema = publicEnvSchema.extend({
  UI_PREVIEW_ENABLED: flagSchema,
  PAYMENTS_MODE: z.enum(['disabled', 'test', 'live']).default('disabled'),
  TOSS_BILLING_ENABLED: flagSchema,
  KAKAOPAY_SUBSCRIPTION_ENABLED: flagSchema,
  SUPABASE_SERVICE_ROLE_KEY: optionalEnvValue(
    secretSchema.refine(
      (value) =>
        /^sb_secret_[A-Za-z0-9_-]+$/.test(value) ||
        hasSupabaseKeyRole(value, 'service_role'),
    ),
  ),
  TOSS_SECRET_KEY: optionalEnvValue(
    z.string().regex(/^(test|live)_sk_[A-Za-z0-9_-]+$/),
  ),
  TOSS_BILLING_MID: optionalEnvValue(secretSchema),
  KAKAOPAY_SECRET_KEY: optionalEnvValue(secretSchema),
  KAKAOPAY_RECURRING_CID: optionalEnvValue(secretSchema),
  KAKAOPAY_CID_SECRET: optionalEnvValue(secretSchema),
  PAYMENTS_VAULT_KEY: optionalEnvValue(
    z.string().regex(PAYMENT_VAULT_KEY_PATTERN),
  ),
  PAYMENTS_VAULT_KEY_VERSION: optionalEnvValue(
    z
      .string()
      .min(1)
      .max(PAYMENT_VAULT_KEY_VERSION_MAX_LENGTH)
      .regex(PAYMENT_VAULT_KEY_VERSION_PATTERN),
  ),
  VAPID_PUBLIC_KEY: optionalEnvValue(secretSchema),
  VAPID_PRIVATE_KEY: optionalEnvValue(secretSchema),
  ALIMTALK_API_KEY: optionalEnvValue(secretSchema),
  CRON_SECRET: optionalEnvValue(secretSchema.min(16)),
  PAYMENTS_RENEWALS_ENABLED: flagSchema,
  RENEWAL_CRON_SECRET: optionalEnvValue(
    z
      .string()
      .min(RENEWAL_CRON_SECRET_MIN_LENGTH)
      .max(RENEWAL_CRON_SECRET_MAX_LENGTH)
      .regex(/^[A-Za-z0-9_-]+$/),
  ),
});

export type ServerEnv = z.output<typeof serverEnvSchema>;

export function parseServerEnv(
  input: unknown,
): Result<ServerEnv, 'CONFIGURATION_INVALID'> {
  if (!input || typeof input !== 'object')
    return failure('CONFIGURATION_INVALID');
  // Reject accidental public exports and obsolete mock/webhook configuration.
  // Ordinary host variables (PATH, CI, etc.) are intentionally stripped.
  const publicKeys = new Set(Object.keys(publicEnvSchema.shape));
  let values: Record<string, unknown>;
  try {
    if (Array.isArray(input)) return failure('CONFIGURATION_INVALID');
    values = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(input)) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        typeof key !== 'string' ||
        !descriptor ||
        !Object.hasOwn(descriptor, 'value')
      )
        return failure('CONFIGURATION_INVALID');
      values[key] = descriptor.value as unknown;
    }
  } catch {
    return failure('CONFIGURATION_INVALID');
  }
  const keys = Object.keys(values);
  if (
    keys.some(
      (key) =>
        (key.startsWith('NEXT_PUBLIC_') && !publicKeys.has(key)) ||
        key === 'PAYMENT_PROVIDER' ||
        key === 'TOSS_WEBHOOK_SECRET',
    )
  )
    return failure('CONFIGURATION_INVALID');
  if (parseRenewalTestRuntime(values).mode === 'invalid')
    return failure('CONFIGURATION_INVALID');
  const result = serverEnvSchema.safeParse(values);
  if (!result.success) return failure('CONFIGURATION_INVALID');
  const env = result.data;
  if (
    Boolean(env.PAYMENTS_VAULT_KEY) !== Boolean(env.PAYMENTS_VAULT_KEY_VERSION)
  )
    return failure('CONFIGURATION_INVALID');
  if (
    (env.PAYMENTS_RENEWALS_ENABLED && !env.RENEWAL_CRON_SECRET) ||
    (env.RENEWAL_CRON_SECRET && env.RENEWAL_CRON_SECRET === env.CRON_SECRET)
  )
    return failure('CONFIGURATION_INVALID');
  const tossModes = [env.NEXT_PUBLIC_TOSS_CLIENT_KEY, env.TOSS_SECRET_KEY]
    .filter((value) => value !== undefined)
    .map((value) => value.split('_')[0]);
  if (
    new Set(tossModes).size > 1 ||
    (env.PAYMENTS_MODE !== 'disabled' &&
      tossModes.some((mode) => mode !== env.PAYMENTS_MODE))
  )
    return failure('CONFIGURATION_INVALID');
  if (
    env.PAYMENTS_MODE === 'live' &&
    (new URL(env.NEXT_PUBLIC_APP_URL).protocol !== 'https:' ||
      KAKAOPAY_TEST_CIDS.some((cid) => cid === env.KAKAOPAY_RECURRING_CID))
  )
    return failure('CONFIGURATION_INVALID');
  if (
    env.PAYMENTS_MODE === 'test' &&
    env.KAKAOPAY_RECURRING_CID &&
    env.KAKAOPAY_RECURRING_CID !== 'TCSUBSCRIP'
  )
    return failure('CONFIGURATION_INVALID');
  return success(env);
}

// Lazy: importing the module or building the preparation UI needs no keys.
export function getServerEnv() {
  return parseServerEnv(process.env);
}

export function isUiPreviewEnabled() {
  return flagSchema.safeParse(process.env.UI_PREVIEW_ENABLED).data === true;
}

export function getEnrollmentTestRuntime() {
  return parseEnrollmentTestRuntime(process.env);
}
