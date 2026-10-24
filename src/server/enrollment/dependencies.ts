import 'server-only';
import { randomUUID } from 'node:crypto';
import { getServerEnv } from '@/config/env.server';
import type { CheckoutProvider } from '@/config/checkout';
import { requireIntegrationConfiguration } from '@/server/configuration';
import { createCheckoutServiceClient } from '@/server/db/checkout-client';
import { createCheckoutSessionPort } from '@/server/db/checkout';
import { createEnrollmentDbPort } from '@/server/db/enrollment';
import { createPaymentVault } from '@/server/adapters/payment/vault';
import { createEnrollmentTransport } from '@/server/adapters/payment/ci-transport';
import { createTossEnrollmentAdapter } from '@/server/adapters/payment/enrollment-toss';
import { createKakaoEnrollmentAdapter } from '@/server/adapters/payment/enrollment-kakaopay';
import { prepareTossBillingAuth } from '@/server/adapters/payment/toss';
import type { EnrollmentDependencies } from '@/server/services/enrollment/flow';

export function enrollmentLaunchAvailable() {
  const parsed = getServerEnv();
  return (
    parsed.ok &&
    !!createPaymentVault(parsed.data) &&
    !!createEnrollmentTransport() &&
    (requireIntegrationConfiguration('toss_card_billing', parsed).ok ||
      requireIntegrationConfiguration('kakaopay_subscription', parsed).ok)
  );
}
export function createEnrollmentDependencies(): EnrollmentDependencies | null {
  const parsed = getServerEnv();
  const client = createCheckoutServiceClient();
  const transport = createEnrollmentTransport();
  if (!parsed.ok || !client || !transport) return null;
  const env = parsed.data;
  const vault = createPaymentVault(env);
  if (!vault) return null;
  return {
    db: createEnrollmentDbPort(client),
    checkout: createCheckoutSessionPort(client),
    vault,
    toss: createTossEnrollmentAdapter(env, transport),
    kakao: createKakaoEnrollmentAdapter(env, transport),
    configuration(provider: CheckoutProvider) {
      const config = requireIntegrationConfiguration(provider, parsed);
      if (!config.ok || config.data.mode === 'disabled') return null;
      const merchant =
        provider === 'toss_card_billing'
          ? env.TOSS_BILLING_MID
          : env.KAKAOPAY_RECURRING_CID;
      return merchant ? { environment: config.data.mode, merchant } : null;
    },
    prepareToss: (identity) => prepareTossBillingAuth(env, identity),
    evidenceRef: () => randomUUID(),
    now: () => new Date(),
  };
}

// Observing/abandoning local state does not require a usable provider or vault.
// Disabling credentials must not hide a pending/unknown operation from its owner.
export function createEnrollmentDatabaseDependencies() {
  const client = createCheckoutServiceClient();
  return client ? { db: createEnrollmentDbPort(client) } : null;
}
