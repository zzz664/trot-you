import 'server-only';
import { randomUUID } from 'node:crypto';
import { getServerEnv } from '@/config/env.server';
import { requireIntegrationConfiguration } from '@/server/configuration';
import { createCheckoutServiceClient } from '@/server/db/checkout-client';
import { createRefundDbPort } from '@/server/db/subscription-management';
import { createRefundTransport } from '@/server/adapters/payment/refund-ci-transport';
import { createTossRefundAdapter } from '@/server/adapters/payment/refund-toss';
import { createKakaoRefundAdapter } from '@/server/adapters/payment/refund-kakaopay';
import type { RefundDependencies } from '@/server/services/subscription/refund';

export function refundExecutionEnabled() {
  const parsed = getServerEnv();
  return parsed.ok && parsed.data.PAYMENTS_REFUNDS_ENABLED;
}
export function createRefundDependencies(): RefundDependencies | null {
  const parsed = getServerEnv();
  if (!parsed.ok) return null;
  const client = createCheckoutServiceClient();
  const transport = createRefundTransport();
  if (!client || !transport) return null;
  const env = parsed.data;
  return {
    db: createRefundDbPort(client),
    toss: createTossRefundAdapter(env, transport),
    kakao: createKakaoRefundAdapter(env, transport),
    dispatchEnabled: env.PAYMENTS_REFUNDS_ENABLED,
    configuration(provider) {
      const config = requireIntegrationConfiguration(provider, parsed);
      if (!config.ok || config.data.mode === 'disabled') return null;
      const merchant =
        provider === 'toss_card_billing'
          ? env.TOSS_BILLING_MID
          : env.KAKAOPAY_RECURRING_CID;
      return merchant ? { environment: config.data.mode, merchant } : null;
    },
    evidenceRef: () => randomUUID(),
    now: () => Date.now(),
  };
}
