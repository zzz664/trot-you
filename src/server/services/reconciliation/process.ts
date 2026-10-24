import 'server-only';
import { z } from 'zod';
import {
  RECONCILIATION_CANDIDATE_LIMIT,
  RECONCILIATION_LEASE_SECONDS,
  type ReconciliationResult,
  type ReconciliationSummary,
} from '@/config/reconciliation';
import { REFUND_TIMESTAMP_PRECISION_MS } from '@/config/subscription-management';
import type { CheckoutProvider } from '@/config/checkout';
import {
  providerTransactionSchema,
  type VerifiedInitialCharge,
} from '@/server/adapters/payment/enrollment';
import type { RenewalPaymentAdapter } from '@/server/adapters/payment/renewal';
import {
  refundInputSchema,
  refundTotals,
  type RefundInput,
  type RefundPaymentAdapter,
  type VerifiedRefund,
} from '@/server/adapters/payment/refund';
import {
  reconciliationSnapshotSchema,
  type ReconciliationDbPort,
  type ReconciliationSnapshot,
  type ReconciledPayment,
} from './model';

// A query-only port deliberately has no charge, approve, refund, ready,
// exchange or vault capability. Recovery cannot accidentally become retry.
export type ReconciliationDependencies = {
  db: ReconciliationDbPort;
  toss: {
    charge: Pick<RenewalPaymentAdapter, 'query'>;
    refund: Pick<RefundPaymentAdapter, 'query'>;
  };
  kakao: {
    charge: Pick<RenewalPaymentAdapter, 'query'>;
    refund: Pick<RefundPaymentAdapter, 'query'>;
  };
  configuration(
    provider: CheckoutProvider,
  ): { environment: 'test' | 'live'; merchant: string } | null;
  evidenceRef(): string;
  now(): number;
};
const unavailable = { ok: false, code: 'UNAVAILABLE' } as const;
function configured(
  deps: ReconciliationDependencies,
  row: ReconciliationSnapshot,
) {
  const config = deps.configuration(
    row.provider === 'toss' ? 'toss_card_billing' : 'kakaopay_subscription',
  );
  return (
    config?.environment === row.environment &&
    config.merchant === row.merchant_account
  );
}
function stableIdentity(
  before: ReconciliationSnapshot,
  after: ReconciliationSnapshot,
) {
  const keys = [
    'id',
    'kind',
    'target_id',
    'subscription_id',
    'provider',
    'environment',
    'merchant_account',
    'customer_ref',
    'order_id',
    'amount_krw',
    'currency',
    'provider_charge_action_id',
    'original_amount_krw',
    'refunded_before_krw',
    'tax_basis',
    'authorized_at',
    'operation_started_at',
  ] as const;
  return keys.every((key) => before[key] === after[key]);
}
function validInstant(value: string, start: string, now: number) {
  return (
    z.iso.datetime({ offset: true }).safeParse(value).success &&
    Date.parse(value) >=
      Math.floor(Date.parse(start) / REFUND_TIMESTAMP_PRECISION_MS) *
        REFUND_TIMESTAMP_PRECISION_MS &&
    Date.parse(value) <= now
  );
}
function validCharge(
  row: ReconciliationSnapshot,
  charge: VerifiedInitialCharge,
  now: number,
) {
  return (
    charge.orderId === row.order_id &&
    charge.customerRef === row.customer_ref &&
    charge.amountKrw === row.amount_krw &&
    charge.currency === row.currency &&
    charge.merchantAccount === row.merchant_account &&
    (!row.provider_payment_id ||
      charge.providerPaymentId === row.provider_payment_id) &&
    providerTransactionSchema.safeParse(charge.providerPaymentId).success &&
    providerTransactionSchema.safeParse(charge.providerTransactionId).success &&
    validInstant(charge.approvedAt, row.operation_started_at, now)
  );
}
function refundInput(row: ReconciliationSnapshot) {
  return refundInputSchema.safeParse({
    attemptId: row.target_id,
    orderId: row.order_id,
    customerRef: row.customer_ref,
    providerPaymentId: row.provider_payment_id,
    originalProviderTransactionId: row.provider_charge_action_id,
    originalAmountKrw: row.original_amount_krw,
    amountKrw: row.amount_krw,
    refundedBeforeKrw: row.refunded_before_krw,
    currency: row.currency,
    taxBasis: row.tax_basis,
  });
}
function validRefund(
  row: ReconciliationSnapshot,
  input: RefundInput,
  refund: VerifiedRefund,
  now: number,
) {
  const totals = refundTotals(input);
  return (
    Object.entries(input).every(
      ([key, value]) => refund[key as keyof RefundInput] === value,
    ) &&
    refund.merchantAccount === row.merchant_account &&
    providerTransactionSchema.safeParse(refund.providerTransactionId).success &&
    refund.providerTransactionId !== row.provider_charge_action_id &&
    refund.cumulativeRefundedKrw === totals.cumulativeRefundedKrw &&
    refund.remainingKrw === totals.remainingKrw &&
    !!row.authorized_at &&
    validInstant(refund.refundedAt, row.authorized_at, now)
  );
}
async function persist(
  deps: ReconciliationDependencies,
  row: ReconciliationSnapshot,
  payment: ReconciledPayment,
) {
  if (!row.lease_token) return unavailable;
  const evidence = deps.evidenceRef();
  let result: ReconciliationResult<ReconciliationSnapshot>;
  try {
    result = await deps.db.complete(row.id, row.lease_token, payment, evidence);
  } catch {
    result = unavailable;
  }
  if (result.ok)
    return reconciliationSnapshotSchema.safeParse(result.data).success
      ? result
      : unavailable;
  // Lost commit response: observe and replay the identical DB operation once,
  // only while this claim remains held. Never repeat provider I/O.
  const observed = await deps.db.read(row.id);
  if (
    !observed.ok ||
    observed.data.id !== row.id ||
    !stableIdentity(row, observed.data)
  )
    return unavailable;
  if (
    !['processing', 'processed', 'manual_review'].includes(
      observed.data.state,
    ) ||
    (observed.data.provider_payment_id &&
      observed.data.provider_payment_id !== payment.providerPaymentId)
  )
    return unavailable;
  // Read projection intentionally hides lease tokens. Reuse only our original
  // token; the atomic RPC rejects a replaced lease and compares all final facts.
  return deps.db.complete(row.id, row.lease_token, payment, evidence);
}
export async function reconcilePayments(
  deps: ReconciliationDependencies,
): Promise<ReconciliationResult<ReconciliationSummary>> {
  const summary: ReconciliationSummary = {
    examined: 0,
    queried: 0,
    settled: 0,
    unknown: 0,
    manualReview: 0,
    skipped: 0,
  };
  try {
    const candidates = await deps.db.candidates(RECONCILIATION_CANDIDATE_LIMIT);
    if (
      !candidates.ok ||
      candidates.data.length > RECONCILIATION_CANDIDATE_LIMIT ||
      new Set(candidates.data).size !== candidates.data.length ||
      candidates.data.some((id) => !z.uuid().safeParse(id).success)
    )
      return unavailable;
    for (const caseId of candidates.data) {
      summary.examined += 1;
      const read = await deps.db.read(caseId);
      if (
        !read.ok ||
        !reconciliationSnapshotSchema.safeParse(read.data).success ||
        read.data.id !== caseId
      )
        return unavailable;
      const before = read.data;
      if (before.state === 'manual_review') {
        summary.manualReview += 1;
        continue;
      }
      if (before.state === 'processed' || !configured(deps, before)) {
        summary.skipped += 1;
        continue;
      }
      // Even a malformed projection must not manufacture a Kakao order lookup.
      // Claim still performs local expired-lease housekeeping/records review.
      const claimed = await deps.db.claim(caseId, RECONCILIATION_LEASE_SECONDS);
      if (
        !claimed.ok ||
        !reconciliationSnapshotSchema.safeParse(claimed.data).success ||
        claimed.data.id !== caseId
      )
        return unavailable;
      const row = claimed.data;
      if (!row.dispatch) {
        if (row.state === 'manual_review') summary.manualReview += 1;
        else summary.skipped += 1;
        continue;
      }
      if (
        !row.lease_token ||
        row.state !== 'processing' ||
        !stableIdentity(before, row) ||
        before.provider_payment_id !== row.provider_payment_id ||
        !configured(deps, row)
      )
        return unavailable;
      if (row.provider === 'kakaopay' && !row.provider_payment_id)
        return unavailable;
      const adapter = row.provider === 'toss' ? deps.toss : deps.kakao;
      let payment: ReconciledPayment | null = null;
      if (
        row.kind === 'refund' &&
        (!row.authorized_at || !refundInput(row).success)
      )
        return unavailable;
      summary.queried = 1;
      try {
        if (row.kind === 'refund') {
          const input = refundInput(row);
          if (!input.success) return unavailable;
          const result = await adapter.refund.query(input.data);
          if (
            result.ok &&
            validRefund(row, input.data, result.data, deps.now())
          )
            payment = { ...result.data, occurredAt: result.data.refundedAt };
        } else {
          const result = await adapter.charge.query({
            customerRef: row.customer_ref,
            orderId: row.order_id,
            amountKrw: row.amount_krw,
            ...(row.provider_payment_id
              ? { providerPaymentId: row.provider_payment_id }
              : {}),
          });
          if (result.ok && validCharge(row, result.data, deps.now()))
            payment = { ...result.data, occurredAt: result.data.approvedAt };
        }
      } catch {
        /* Any transport/parser exception leaves financial outcome unknown. */
      }
      if (payment) {
        const saved = await persist(deps, row, payment);
        if (
          !saved.ok ||
          !reconciliationSnapshotSchema.safeParse(saved.data).success ||
          !stableIdentity(row, saved.data) ||
          saved.data.provider_payment_id !== payment.providerPaymentId ||
          (saved.data.state === 'processed' && !saved.data.payment_event_id) ||
          !['processed', 'manual_review'].includes(saved.data.state)
        )
          return unavailable;
        if (saved.data.state === 'manual_review') summary.manualReview += 1;
        else summary.settled = 1;
      } else {
        const saved = await deps.db.defer(row.id, row.lease_token);
        if (
          !saved.ok ||
          !reconciliationSnapshotSchema.safeParse(saved.data).success ||
          !stableIdentity(row, saved.data) ||
          saved.data.provider_payment_id !== row.provider_payment_id ||
          !['retry', 'manual_review'].includes(saved.data.state)
        )
          return unavailable;
        summary.unknown = 1;
        if (saved.data.state === 'manual_review') summary.manualReview += 1;
      }
      break; // One provider query per invocation, including errors and recovery.
    }
    return { ok: true, data: summary };
  } catch {
    return unavailable;
  }
}
