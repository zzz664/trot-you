import 'server-only';
import { z } from 'zod';
import {
  REFUND_LEASE_SECONDS,
  REFUND_TIMESTAMP_PRECISION_MS,
  refundActionInputSchema,
  type AdminRefundDetail,
  type ManagementResult,
} from '@/config/subscription-management';
import type { CheckoutProvider } from '@/config/checkout';
import {
  refundInputSchema,
  refundTotals,
  type RefundInput,
  type RefundPaymentAdapter,
  type VerifiedRefund,
} from '@/server/adapters/payment/refund';
import { providerTransactionSchema } from '@/server/adapters/payment/enrollment';
import type {
  ManagementDbPort,
  RefundDbPort,
  RefundSnapshot,
} from './management-model';
import { readAdminRefund } from './manage';

export type RefundDependencies = {
  db: RefundDbPort;
  toss: RefundPaymentAdapter;
  kakao: RefundPaymentAdapter;
  dispatchEnabled: boolean;
  configuration(
    provider: CheckoutProvider,
  ): { environment: 'test' | 'live'; merchant: string } | null;
  evidenceRef(): string;
  now(): number;
};
const unavailable = { ok: false, code: 'UNAVAILABLE' } as const;
function providerOf(row: RefundSnapshot): CheckoutProvider {
  return row.provider === 'toss'
    ? 'toss_card_billing'
    : 'kakaopay_subscription';
}
function configured(deps: RefundDependencies, row: RefundSnapshot) {
  const config = deps.configuration(providerOf(row));
  return (
    config?.environment === row.environment &&
    config.merchant === row.merchant_account
  );
}
function paymentInput(row: RefundSnapshot) {
  return refundInputSchema.safeParse({
    attemptId: row.request_id,
    orderId: row.order_id,
    customerRef: row.customer_ref,
    providerPaymentId: row.provider_payment_id,
    originalProviderTransactionId: row.provider_charge_action_id,
    originalAmountKrw: row.charge_amount_krw,
    amountKrw: row.amount_krw,
    refundedBeforeKrw: row.refunded_before_krw,
    currency: row.currency,
    taxBasis: row.payment_tax_basis,
  });
}
function sameClaim(before: RefundSnapshot, after: RefundSnapshot) {
  return (
    before.request_id === after.request_id &&
    before.subscription_id === after.subscription_id &&
    before.user_id === after.user_id &&
    before.original_event_id === after.original_event_id &&
    before.provider === after.provider &&
    before.environment === after.environment &&
    before.merchant_account === after.merchant_account &&
    before.policy_version === after.policy_version &&
    before.authorized_at === after.authorized_at &&
    before.requested_at === after.requested_at &&
    before.action === after.action &&
    JSON.stringify(paymentInput(before).data) ===
      JSON.stringify(paymentInput(after).data)
  );
}
function verified(
  deps: RefundDependencies,
  row: RefundSnapshot,
  input: RefundInput,
  refund: VerifiedRefund,
) {
  const totals = refundTotals(input);
  const at = Date.parse(refund.refundedAt);
  return (
    Object.entries(input).every(
      ([key, value]) => refund[key as keyof RefundInput] === value,
    ) &&
    refund.merchantAccount === row.merchant_account &&
    providerTransactionSchema.safeParse(refund.providerTransactionId).success &&
    refund.providerTransactionId !== row.provider_charge_action_id &&
    refund.cumulativeRefundedKrw === totals.cumulativeRefundedKrw &&
    refund.remainingKrw === totals.remainingKrw &&
    z.iso.datetime({ offset: true }).safeParse(refund.refundedAt).success &&
    row.authorized_at !== null &&
    at >=
      Math.floor(
        Date.parse(row.authorized_at) / REFUND_TIMESTAMP_PRECISION_MS,
      ) *
        REFUND_TIMESTAMP_PRECISION_MS &&
    at <= deps.now()
  );
}
async function finalize(
  deps: RefundDependencies,
  row: RefundSnapshot,
  refund: VerifiedRefund,
) {
  const evidence = deps.evidenceRef();
  const result = await deps.db.finalize(row.request_id, refund, evidence);
  if (result.ok) return result;
  // Commit-response loss is not permission to repeat external refund I/O.
  // Observe durable outcome, then retry only identical financial finalization.
  const observed = await deps.db.read(row.request_id);
  if (!observed.ok || observed.data.request_id !== row.request_id)
    return unavailable;
  if (observed.data.state === 'succeeded' && observed.data.payment_event_id)
    return { ok: true as const, data: observed.data.payment_event_id };
  if (!['inflight', 'unknown'].includes(observed.data.state))
    return unavailable;
  return deps.db.finalize(row.request_id, refund, evidence);
}

export async function runRefund(
  deps: RefundDependencies,
  actorDb: ManagementDbPort,
  actorId: string,
  input: unknown,
  mode: 'execute' | 'reconcile',
): Promise<ManagementResult<AdminRefundDetail>> {
  const parsed = refundActionInputSchema.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(actorId).success)
    return { ok: false, code: 'INVALID_INPUT' };
  try {
    // Actor-token RPC verifies current unrestricted admin before any private read.
    const access = await readAdminRefund(
      actorDb,
      parsed.data,
      deps.dispatchEnabled,
    );
    if (!access.ok) return access;
    const read = await deps.db.read(parsed.data.requestId);
    if (!read.ok || read.data.request_id !== parsed.data.requestId)
      return unavailable;
    const before = read.data;
    if (
      before.original_event_id !== access.data.request.original_event_id ||
      before.amount_krw !== access.data.request.amount_krw ||
      before.subscription_id !== access.data.request.subscription_id
    )
      return unavailable;
    if (mode === 'execute' && !deps.dispatchEnabled)
      return { ok: false, code: 'EXECUTION_DISABLED' };
    const actionAllowed =
      mode === 'execute'
        ? before.action === 'refund'
        : before.action === 'reconcile' || before.action === 'lease_expired';
    if (!actionAllowed)
      return readAdminRefund(actorDb, parsed.data, deps.dispatchEnabled);
    // Lease expiry is a local unknown-state repair; no provider config needed.
    if (before.action !== 'lease_expired' && !configured(deps, before))
      return { ok: false, code: 'SETUP_NOT_READY' };
    const providerInput = paymentInput(before);
    if (before.action !== 'lease_expired' && !providerInput.success)
      return unavailable;
    const claimed = await deps.db.claim(
      before.request_id,
      actorId,
      REFUND_LEASE_SECONDS,
    );
    if (!claimed.ok) return claimed;
    const row = claimed.data;
    if (row.request_id !== before.request_id) return unavailable;
    if (!row.dispatch)
      return readAdminRefund(actorDb, parsed.data, deps.dispatchEnabled);
    if (
      !row.lease_token ||
      !sameClaim(before, row) ||
      !providerInput.success ||
      !configured(deps, row) ||
      (mode === 'execute'
        ? row.action !== 'refund' || row.state !== 'inflight'
        : row.action !== 'reconcile' || row.state !== 'unknown')
    )
      return unavailable;
    const adapter = row.provider === 'toss' ? deps.toss : deps.kakao;
    let result;
    try {
      result = await (mode === 'execute'
        ? adapter.refund(providerInput.data)
        : adapter.query(providerInput.data));
    } catch {
      result = { ok: false as const, outcome: 'unknown' as const };
    }
    if (result.ok && verified(deps, row, providerInput.data, result.data)) {
      const settled = await finalize(deps, row, result.data);
      if (!settled.ok) return settled;
    } else {
      // A failed query never proves a refund did not happen. Every ambiguous,
      // malformed or rejected HTTP result stays unknown unless the adapter has
      // explicit, documented definitive-rejection evidence on first dispatch.
      const outcome =
        !result.ok && result.outcome === 'rejected' && mode === 'execute'
          ? 'failed'
          : 'unknown';
      const saved = await deps.db.outcome(
        row.request_id,
        row.lease_token,
        outcome,
        deps.evidenceRef(),
      );
      if (!saved.ok) return saved;
    }
    return readAdminRefund(actorDb, parsed.data, deps.dispatchEnabled);
  } catch {
    return unavailable;
  }
}
