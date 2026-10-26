import 'server-only';
import { createAnalyticsCapturePort } from '@/server/db/analytics-capture';
import { observeRenewal } from '@/server/services/analytics/payment-observations';
import { randomUUID } from 'node:crypto';
import { getServerEnv } from '@/config/env.server';
import type { CheckoutProvider } from '@/config/checkout';
import { requireIntegrationConfiguration } from '@/server/configuration';
import { createCheckoutServiceClient } from '@/server/db/checkout-client';
import { createRenewalDbPort } from '@/server/db/renewal';
import { createPaymentVault } from '@/server/adapters/payment/vault';
import { createEnrollmentTransport } from '@/server/adapters/payment/ci-transport';
import { createTossRenewalAdapter } from '@/server/adapters/payment/renewal-toss';
import { createKakaoRenewalAdapter } from '@/server/adapters/payment/renewal-kakaopay';
import type { RenewalDependencies } from '@/server/services/subscription/charge-due';

export function createRenewalDependencies(): RenewalDependencies | null {
  const parsed = getServerEnv();
  if (!parsed.ok || !parsed.data.PAYMENTS_RENEWALS_ENABLED) return null;
  const client = createCheckoutServiceClient();
  const transport = createEnrollmentTransport();
  if (!client || !transport) return null;
  const env = parsed.data;
  return {
    db: observeRenewal(
      createRenewalDbPort(client),
      createAnalyticsCapturePort(client),
    ),
    // Expiry and query recovery must still work when an encryption key has
    // been removed. Only a new charge requires successful vault decryption.
    vault: createPaymentVault(env),
    toss: createTossRenewalAdapter(env, transport),
    kakao: createKakaoRenewalAdapter(env, transport),
    configuration(provider: CheckoutProvider) {
      const config = requireIntegrationConfiguration(provider, parsed);
      if (!config.ok || config.data.mode === 'disabled') return null;
      const merchant =
        provider === 'toss_card_billing'
          ? env.TOSS_BILLING_MID
          : env.KAKAOPAY_RECURRING_CID;
      return merchant ? { environment: config.data.mode, merchant } : null;
    },
    evidenceRef: () => randomUUID(),
  };
}
