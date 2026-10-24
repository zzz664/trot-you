import 'server-only';
import type { ServerEnv } from '@/config/env.server';
import { TOSS_BILLING_SDK_URL } from '@/config/payment-preparation';
import { requireIntegrationConfiguration } from '@/server/configuration';
import {
  preparationCallbacks,
  parsePreparationEnvironment,
  preparationFailure,
  preparationIdentitySchema,
  type PreparationIdentity,
  type PreparationResult,
} from './preparation';

export type TossBillingAuthPreparation = {
  kind: 'toss_billing_auth';
  sdkUrl: typeof TOSS_BILLING_SDK_URL;
  clientKey: string;
  payment: { customerKey: string };
  requestBillingAuth: {
    method: 'CARD';
    successUrl: string;
    failUrl: string;
  };
  launchAvailable: false;
};

// Descriptor of the real SDK protocol, not a fictional registration API URL.
// Deliberately not imported by a client/route: finalization and the encrypted
// credential vault are required before launching an authorization flow.
export function prepareTossBillingAuth(
  env: ServerEnv,
  input: PreparationIdentity,
): PreparationResult<TossBillingAuthPreparation> {
  const configuration = requireIntegrationConfiguration(
    'toss_card_billing',
    parsePreparationEnvironment(env),
  );
  if (!configuration.ok) return preparationFailure(configuration.error.code);
  const identity = preparationIdentitySchema.safeParse(input);
  if (!identity.success) return preparationFailure('INVALID_INPUT');
  const callbacks = preparationCallbacks(
    configuration.data.appOrigin,
    identity.data,
  );
  if (!callbacks) return preparationFailure('CONFIGURATION_INVALID');
  return {
    ok: true,
    data: {
      kind: 'toss_billing_auth',
      sdkUrl: TOSS_BILLING_SDK_URL,
      clientKey: configuration.data.credentials.NEXT_PUBLIC_TOSS_CLIENT_KEY,
      payment: { customerKey: identity.data.customerRef },
      requestBillingAuth: {
        method: 'CARD',
        successUrl: callbacks.successUrl,
        failUrl: callbacks.failUrl,
      },
      launchAvailable: false,
    },
  };
}
