import 'server-only';
import { getServerEnv } from '@/config/env.server';
import { BILLING_NOTICE } from '@/config/billing-notices';
import { createCheckoutServiceClient } from '@/server/db/checkout-client';
import { createBillingNoticeQueuePort } from '@/server/db/billing-notices';
import type { BillingNoticeQueueDependencies } from '@/server/services/billing-notices/create-due';

export function createBillingNoticeQueueDependencies(): BillingNoticeQueueDependencies | null {
  const parsed = getServerEnv();
  if (
    !parsed.ok ||
    !parsed.data.BILLING_NOTICES_ENABLED ||
    !parsed.data.BILLING_NOTICES_CRON_SECRET
  )
    return null;
  const client = createCheckoutServiceClient(BILLING_NOTICE.databaseTimeoutMs);
  return client
    ? { port: createBillingNoticeQueuePort(client), now: Date.now }
    : null;
}
