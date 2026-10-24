import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ServerEnv } from '@/config/env.server';
import type { CheckoutServiceClient } from '@/server/db/checkout-client';
import {
  createReconciliationDbPort,
  createEnrollmentReconciliationCasePort,
} from '@/server/db/reconciliation';
import type { EnrollmentTransport } from '@/server/adapters/payment/enrollment';
import { createTossRenewalAdapter } from '@/server/adapters/payment/renewal-toss';
import { createKakaoRenewalAdapter } from '@/server/adapters/payment/renewal-kakaopay';
import { requireIntegrationConfiguration } from '@/server/configuration';
import {
  recoverInitialPayment,
  type InitialRecoveryDependencies,
} from '@/server/services/reconciliation/initial';

export function createInitialPaymentRecovery(
  env: ServerEnv,
  client: CheckoutServiceClient,
  transport: EnrollmentTransport,
) {
  const toss = createTossRenewalAdapter(env, transport);
  const kakao = createKakaoRenewalAdapter(env, transport);
  const noRefund = {
    query: async () => {
      throw new Error('RECOVERY_KIND_INVALID');
    },
  };
  const deps: InitialRecoveryDependencies = {
    db: createReconciliationDbPort(client),
    ...createEnrollmentReconciliationCasePort(client),
    toss: { charge: { query: toss.query }, refund: noRefund },
    kakao: { charge: { query: kakao.query }, refund: noRefund },
    configuration(provider) {
      const config = requireIntegrationConfiguration(provider, {
        ok: true,
        data: env,
      });
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
  // Explicit owner recovery predates the optional worker. Both use the same
  // durable budget now; disabling a scheduler is not a permission to re-charge.
  return {
    recover: (actorId: string, sessionId: string) =>
      recoverInitialPayment(deps, actorId, sessionId),
  };
}
