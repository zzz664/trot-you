import 'server-only';
import { randomUUID } from 'node:crypto';
import { getServerEnv } from '@/config/env.server';
import { requireIntegrationConfiguration } from '@/server/configuration';
import { createCheckoutServiceClient } from '@/server/db/checkout-client';
import { createReconciliationDbPort } from '@/server/db/reconciliation';
import { createEnrollmentTransport } from '@/server/adapters/payment/ci-transport';
import { createRefundTransport } from '@/server/adapters/payment/refund-ci-transport';
import { createTossRenewalAdapter } from '@/server/adapters/payment/renewal-toss';
import { createKakaoRenewalAdapter } from '@/server/adapters/payment/renewal-kakaopay';
import { createTossRefundAdapter } from '@/server/adapters/payment/refund-toss';
import { createKakaoRefundAdapter } from '@/server/adapters/payment/refund-kakaopay';
import type { ReconciliationDependencies } from '@/server/services/reconciliation/process';

export function createReconciliationDependencies(): ReconciliationDependencies | null {
  const parsed = getServerEnv();
  if (!parsed.ok || !parsed.data.PAYMENTS_RECONCILIATION_ENABLED) return null;
  const client = createCheckoutServiceClient();
  const chargeTransport = createEnrollmentTransport();
  const refundTransport = createRefundTransport();
  if (!client || !chargeTransport || !refundTransport) return null;
  const env = parsed.data;
  const tossCharge = createTossRenewalAdapter(env, chargeTransport);
  const kakaoCharge = createKakaoRenewalAdapter(env, chargeTransport);
  const tossRefund = createTossRefundAdapter(env, refundTransport);
  const kakaoRefund = createKakaoRefundAdapter(env, refundTransport);
  return {
    db: createReconciliationDbPort(client),
    // Strip mutating capabilities at composition, not just in the type.
    toss: {
      charge: { query: tossCharge.query },
      refund: { query: tossRefund.query },
    },
    kakao: {
      charge: { query: kakaoCharge.query },
      refund: { query: kakaoRefund.query },
    },
    configuration(provider) {
      const configured = requireIntegrationConfiguration(provider, parsed);
      if (!configured.ok || configured.data.mode === 'disabled') return null;
      const merchant =
        provider === 'toss_card_billing'
          ? env.TOSS_BILLING_MID
          : env.KAKAOPAY_RECURRING_CID;
      return merchant ? { environment: configured.data.mode, merchant } : null;
    },
    evidenceRef: () => randomUUID(),
    now: () => Date.now(),
  };
}
