import 'server-only';
import type { ReconciliationResult } from '@/config/reconciliation';
import type { UntrustedTossProviderEvent } from '@/server/adapters/payment/provider-events';

export type ProviderReceiptPort = {
  receive(
    environment: 'test' | 'live',
    event: UntrustedTossProviderEvent,
  ): Promise<ReconciliationResult<{ accepted: boolean; duplicate: boolean }>>;
};
export type ProviderReceiptDependencies = {
  db: ProviderReceiptPort;
  environment: 'test' | 'live';
  merchant: string;
};
export async function receiveTossEvent(
  deps: ProviderReceiptDependencies,
  event: UntrustedTossProviderEvent,
): Promise<ReconciliationResult<null>> {
  // The request has no general provider signature. Parse+matching only makes a
  // bounded advisory receipt, never financial evidence or trusted payment ID.
  if (event.trust !== 'unverified' || event.provider !== 'toss')
    return { ok: false, code: 'UNAVAILABLE' };
  if (event.merchantAccount !== deps.merchant) return { ok: true, data: null };
  try {
    const result = await deps.db.receive(deps.environment, event);
    // Unknown order and duplicate have the same outward response; no payment
    // identity/operation existence oracle. Only durable DB failure requests retry.
    return result.ok ? { ok: true, data: null } : result;
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
