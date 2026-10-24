import 'server-only';
import { z } from 'zod';
import type { CheckoutServiceClient } from './checkout-client';
import type { ProviderReceiptPort } from '@/server/services/reconciliation/receive';
const receiptSchema = z.strictObject({
  accepted: z.boolean(),
  duplicate: z.boolean(),
});
export function createProviderReceiptPort(
  client: CheckoutServiceClient,
): ProviderReceiptPort {
  return {
    async receive(environment, event) {
      const { data, error } = await client.rpc('reconciliation_receive_toss', {
        p_environment: environment,
        p_merchant_account: event.merchantAccount,
        p_order_id: event.orderId,
        p_payment_id: event.providerPaymentId,
        p_status: event.status,
        p_amount_krw: event.totalAmountKrw,
        p_payload_digest: event.semanticKey,
      });
      const parsed = receiptSchema.safeParse(data);
      return !error && parsed.success
        ? { ok: true, data: parsed.data }
        : { ok: false, code: 'UNAVAILABLE' };
    },
  };
}
