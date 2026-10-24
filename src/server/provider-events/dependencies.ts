import 'server-only';
import { getServerEnv } from '@/config/env.server';
import { RECONCILIATION_RECEIPT_TIMEOUT_MS } from '@/config/reconciliation';
import { requireIntegrationConfiguration } from '@/server/configuration';
import { createCheckoutServiceClient } from '@/server/db/checkout-client';
import { createProviderReceiptPort } from '@/server/db/provider-events';
import type { ProviderReceiptDependencies } from '@/server/services/reconciliation/receive';
export function createProviderReceiptDependencies(): ProviderReceiptDependencies | null {
  const parsed = getServerEnv();
  if (!parsed.ok || !parsed.data.PAYMENTS_RECONCILIATION_ENABLED) return null;
  const configuration = requireIntegrationConfiguration(
    'toss_card_billing',
    parsed,
  );
  if (!configuration.ok || configuration.data.mode === 'disabled') return null;
  // Six-second DB deadline plus one-second body deadline is below Toss's ten
  // second acknowledgement window. No provider HTTP query runs on this path.
  const client = createCheckoutServiceClient(RECONCILIATION_RECEIPT_TIMEOUT_MS);
  return client
    ? {
        db: createProviderReceiptPort(client),
        environment: configuration.data.mode,
        merchant: configuration.data.credentials.TOSS_BILLING_MID,
      }
    : null;
}
