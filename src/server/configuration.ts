import 'server-only';
import {
  getServerEnv,
  parseServerEnv,
  type ServerEnv,
} from '@/config/env.server';
import {
  INTEGRATION_REQUIREMENTS,
  PAYMENT_LAUNCH_GATES,
  type IntegrationId,
  type RequiredEnvironmentKey,
} from '@/config/integrations';
import { failure, success, type Result } from '@/lib/result';

type CredentialState = 'disabled' | 'missing' | 'configured';
export type IntegrationConfiguration = {
  readonly state: CredentialState;
  readonly missing: readonly RequiredEnvironmentKey[];
  // This feature performs no external I/O; configured credentials are not proof
  // of a working integration, valid contract or permission to charge.
  readonly operational: false;
};
export type ConfigurationReport = {
  readonly paymentsMode: ServerEnv['PAYMENTS_MODE'];
  readonly integrations: Record<IntegrationId, IntegrationConfiguration>;
  readonly paymentLaunchGates: typeof PAYMENT_LAUNCH_GATES;
};

function isEnabled(env: ServerEnv, integration: IntegrationId) {
  if (integration === 'toss_card_billing')
    return env.PAYMENTS_MODE !== 'disabled' && env.TOSS_BILLING_ENABLED;
  if (integration === 'kakaopay_subscription')
    return (
      env.PAYMENTS_MODE !== 'disabled' && env.KAKAOPAY_SUBSCRIPTION_ENABLED
    );
  return true;
}

function inspect(
  env: ServerEnv,
  integration: IntegrationId,
): IntegrationConfiguration {
  const missing = INTEGRATION_REQUIREMENTS[integration].filter(
    (key) => !env[key],
  );
  return {
    state: !isEnabled(env, integration)
      ? 'disabled'
      : missing.length
        ? 'missing'
        : 'configured',
    missing,
    operational: false,
  };
}

export function inspectConfiguration(
  input: unknown,
): Result<ConfigurationReport, 'CONFIGURATION_INVALID'> {
  const result = parseServerEnv(input);
  if (!result.ok) return result;
  const env = result.data;
  return success({
    paymentsMode: env.PAYMENTS_MODE,
    integrations: {
      supabase: inspect(env, 'supabase'),
      toss_card_billing: inspect(env, 'toss_card_billing'),
      kakaopay_subscription: inspect(env, 'kakaopay_subscription'),
      webpush: inspect(env, 'webpush'),
      alimtalk: inspect(env, 'alimtalk'),
      cron: inspect(env, 'cron'),
    },
    paymentLaunchGates: PAYMENT_LAUNCH_GATES,
  });
}

type CredentialKey<I extends IntegrationId> =
  (typeof INTEGRATION_REQUIREMENTS)[I][number];
export type IntegrationCredentials<I extends IntegrationId> =
  I extends IntegrationId
    ? {
        [K in CredentialKey<I>]: string;
      } & (I extends 'kakaopay_subscription'
        ? { KAKAOPAY_CID_SECRET?: string }
        : object)
    : never;

// Distribute over a dynamic provider union so credentials are available only
// after narrowing integration, never a fictitious intersection of all keys.
export type RequiredIntegrationConfiguration<I extends IntegrationId> =
  I extends IntegrationId
    ? {
        readonly integration: I;
        readonly mode: ServerEnv['PAYMENTS_MODE'];
        readonly appOrigin: string;
        readonly credentials: IntegrationCredentials<I>;
        readonly operational: false;
      }
    : never;

// Require complete configuration, never a mock fallback. Project only this
// integration's keys; even this smaller object is secret-bearing server data.
export function requireIntegrationConfiguration<I extends IntegrationId>(
  integration: I,
  parsed = getServerEnv(),
): Result<
  RequiredIntegrationConfiguration<I>,
  'CONFIGURATION_INVALID' | 'INTEGRATION_UNAVAILABLE'
> {
  if (!parsed.ok) return parsed;
  if (
    !Object.hasOwn(INTEGRATION_REQUIREMENTS, integration) ||
    inspect(parsed.data, integration).state !== 'configured'
  )
    return failure('INTEGRATION_UNAVAILABLE');
  const env = parsed.data;
  const entries = INTEGRATION_REQUIREMENTS[integration].map((key) => [
    key,
    env[key],
  ]);
  if (integration === 'kakaopay_subscription' && env.KAKAOPAY_CID_SECRET) {
    entries.push(['KAKAOPAY_CID_SECRET', env.KAKAOPAY_CID_SECRET]);
  }
  // inspect above established every required value as a nonempty string. The
  // same integration key selects this projection and its generic output type.
  const credentials = Object.fromEntries(entries) as IntegrationCredentials<I>;
  const configuration = {
    integration,
    mode: env.PAYMENTS_MODE,
    appOrigin: env.NEXT_PUBLIC_APP_URL,
    credentials,
    operational: false,
  } as RequiredIntegrationConfiguration<I>;
  return success(configuration);
}
