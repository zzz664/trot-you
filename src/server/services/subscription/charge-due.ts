import 'server-only';
import { z } from 'zod';
import {
  RENEWAL_CANDIDATE_LIMIT,
  RENEWAL_LEASE_SECONDS,
  type RenewalResult,
  type RenewalSummary,
} from '@/config/renewal';
import type { CheckoutProvider } from '@/config/checkout';
import { renewalBillingPeriod } from '@/lib/billing-period';
import type { PaymentVault } from '@/server/adapters/payment/vault';
import {
  providerCredentialSchema,
  providerTransactionSchema,
  type VerifiedInitialCharge,
} from '@/server/adapters/payment/enrollment';
import type { RenewalPaymentAdapter } from '@/server/adapters/payment/renewal';
import type { RenewalDbPort, RenewalSnapshot } from './renewal-model';

export type RenewalDependencies = {
  db: RenewalDbPort;
  vault: PaymentVault | null;
  toss: RenewalPaymentAdapter;
  kakao: RenewalPaymentAdapter;
  configuration(
    provider: CheckoutProvider,
  ): { environment: 'test' | 'live'; merchant: string } | null;
  evidenceRef(): string;
};
const unavailable: RenewalResult<never> = { ok: false, code: 'UNAVAILABLE' };
function providerOf(row: RenewalSnapshot): CheckoutProvider {
  return row.provider === 'toss'
    ? 'toss_card_billing'
    : 'kakaopay_subscription';
}
function validConfiguration(deps: RenewalDependencies, row: RenewalSnapshot) {
  const configured = deps.configuration(providerOf(row));
  return (
    !!configured &&
    configured.environment === row.environment &&
    configured.merchant === row.merchant_account
  );
}
function sameClaim(before: RenewalSnapshot, after: RenewalSnapshot) {
  // The credential was decrypted before claim; never dispatch with a different
  // mandate/amount/period/policy supplied by a stale or malformed response.
  return (
    before.subscription_id === after.subscription_id &&
    before.user_id === after.user_id &&
    before.artist_id === after.artist_id &&
    before.mandate_id === after.mandate_id &&
    before.provider === after.provider &&
    before.environment === after.environment &&
    before.merchant_account === after.merchant_account &&
    before.customer_ref === after.customer_ref &&
    before.policy_version === after.policy_version &&
    before.amount_krw === after.amount_krw &&
    before.period_start === after.period_start &&
    before.period_end === after.period_end &&
    before.action === after.action &&
    before.billing_period_calendar === after.billing_period_calendar &&
    before.payment_tax_basis === after.payment_tax_basis &&
    before.episode_started_at === after.episode_started_at &&
    (before.action !== 'reconcile' ||
      (before.attempt_id === after.attempt_id &&
        before.provider_payment_id === after.provider_payment_id)) &&
    JSON.stringify(before.credential_ciphertext) ===
      JSON.stringify(after.credential_ciphertext)
  );
}
function validCharge(row: RenewalSnapshot, charge: VerifiedInitialCharge) {
  return (
    charge.orderId === row.attempt_id &&
    charge.customerRef === row.customer_ref &&
    charge.amountKrw === row.amount_krw &&
    charge.merchantAccount === row.merchant_account &&
    charge.currency === 'KRW' &&
    providerTransactionSchema.safeParse(charge.providerPaymentId).success &&
    providerTransactionSchema.safeParse(charge.providerTransactionId).success &&
    z.iso.datetime({ offset: true }).safeParse(charge.approvedAt).success
  );
}

// If the result write's response is lost, observe durable state before replaying
// that exact idempotent finalization once. Never repeat provider I/O. A failed
// read or second write remains unavailable, not a presumed charge failure.
async function settle(
  deps: RenewalDependencies,
  row: RenewalSnapshot,
  charge: VerifiedInitialCharge,
) {
  if (!row.attempt_id) return unavailable;
  const evidence = deps.evidenceRef();
  const saved = await deps.db.finalize(row.attempt_id, charge, evidence);
  if (saved.ok) return saved;
  const observed = await deps.db.readAttempt(row.attempt_id);
  if (!observed.ok || observed.data.attempt_id !== row.attempt_id)
    return unavailable;
  if (observed.data.state === 'success' && observed.data.payment_event_id)
    return { ok: true as const, data: observed.data.payment_event_id };
  if (!['inflight', 'unknown'].includes(observed.data.state))
    return unavailable;
  return deps.db.finalize(row.attempt_id, charge, evidence);
}
async function unknown(deps: RenewalDependencies, row: RenewalSnapshot) {
  if (!row.attempt_id || !row.lease_token) return unavailable;
  return row.action === 'reconcile'
    ? deps.db.queryUnknown(row.attempt_id, row.lease_token)
    : deps.db.outcome(
        row.attempt_id,
        row.lease_token,
        'unknown',
        deps.evidenceRef(),
        false,
      );
}

export async function chargeDueRenewals(
  deps: RenewalDependencies,
): Promise<RenewalResult<RenewalSummary>> {
  const summary: RenewalSummary = {
    examined: 0,
    dispatched: 0,
    settled: 0,
    declined: 0,
    unknown: 0,
    manualReview: 0,
    expired: 0,
    skipped: 0,
  };
  try {
    const selected = await deps.db.candidates(RENEWAL_CANDIDATE_LIMIT);
    if (
      !selected.ok ||
      selected.data.length > RENEWAL_CANDIDATE_LIMIT ||
      new Set(selected.data).size !== selected.data.length ||
      selected.data.some((id) => !z.uuid().safeParse(id).success)
    )
      return unavailable;
    for (const subscriptionId of selected.data) {
      summary.examined += 1;
      const read = await deps.db.read(subscriptionId);
      if (!read.ok || read.data.subscription_id !== subscriptionId)
        return unavailable;
      const before = read.data;
      if (before.action === 'manual_review') {
        summary.manualReview += 1;
        continue;
      }
      if (['none', 'blocked'].includes(before.action)) {
        summary.skipped += 1;
        continue;
      }
      if (before.action === 'expired' || before.action === 'lease_expired') {
        const result = await deps.db.claim(before, RENEWAL_LEASE_SECONDS);
        if (!result.ok) return unavailable;
        if (result.data.subscription_status === 'expired') summary.expired += 1;
        else if (result.data.action === 'manual_review')
          summary.manualReview += 1;
        else summary.skipped += 1;
        continue;
      }
      if (!validConfiguration(deps, before)) {
        summary.skipped += 1;
        continue;
      }
      if (
        !before.mandate_id ||
        !before.customer_ref ||
        !before.amount_krw ||
        !before.period_start ||
        !before.period_end ||
        !before.episode_started_at ||
        !before.billing_period_calendar ||
        !before.payment_tax_basis
      )
        return unavailable;
      // Query recovery uses the original immutable period even after expiry or
      // cancellation. It never creates a catch-up period or needs clear keys.
      if (before.action === 'charge') {
        const period = renewalBillingPeriod(
          new Date(before.episode_started_at),
          new Date(before.period_start),
          before.billing_period_calendar,
        );
        if (Date.parse(period.end) !== Date.parse(before.period_end))
          return unavailable;
      }
      let credential: string | null = null;
      if (before.action === 'charge') {
        if (
          !deps.vault ||
          !before.credential_ciphertext ||
          !before.environment
        ) {
          summary.skipped += 1;
          continue;
        }
        try {
          credential = providerCredentialSchema.parse(
            deps.vault.open(before.credential_ciphertext, {
              actorId: before.user_id,
              artistId: before.artist_id,
              provider: providerOf(before),
              environment: before.environment,
              mandateId: before.mandate_id,
              purpose: 'credential',
            }),
          );
        } catch {
          summary.skipped += 1;
          continue;
        }
      }
      // Kakao cannot recover an order from SID status. Even a malformed DB
      // projection cannot cause a query without a known TID or another charge.
      if (
        before.action === 'reconcile' &&
        before.provider === 'kakaopay' &&
        !before.provider_payment_id
      ) {
        summary.manualReview += 1;
        continue;
      }
      const claimed = await deps.db.claim(before, RENEWAL_LEASE_SECONDS);
      if (!claimed.ok) return unavailable;
      const row = claimed.data;
      if (!row.dispatch) {
        if (row.action === 'manual_review') summary.manualReview += 1;
        else if (row.subscription_status === 'expired') summary.expired += 1;
        else summary.skipped += 1;
        continue;
      }
      if (
        !row.attempt_id ||
        !row.lease_token ||
        !sameClaim(before, row) ||
        !validConfiguration(deps, row)
      )
        return unavailable;
      const adapter = row.provider === 'toss' ? deps.toss : deps.kakao;
      const identity = {
        customerRef: before.customer_ref,
        orderId: row.attempt_id,
        amountKrw: before.amount_krw,
      };
      summary.dispatched = 1;
      try {
        const result =
          row.action === 'charge' && credential
            ? await adapter.charge({
                ...identity,
                credential,
                idempotencyKey: row.attempt_id,
              })
            : await adapter.query({
                ...identity,
                ...(row.provider_payment_id
                  ? { providerPaymentId: row.provider_payment_id }
                  : {}),
              });
        if (result.ok && validCharge(row, result.data)) {
          const saved = await settle(deps, row, result.data);
          if (!saved.ok) return unavailable;
          summary.settled = 1;
        } else if (
          !result.ok &&
          row.action === 'charge' &&
          result.code === 'PROVIDER_REJECTED' &&
          result.outcome === 'rejected'
        ) {
          const saved = await deps.db.outcome(
            row.attempt_id,
            row.lease_token,
            'failed',
            deps.evidenceRef(),
            result.failureDisposition === 'retryable',
          );
          if (!saved.ok) return unavailable;
          summary.declined = 1;
        } else {
          const saved = await unknown(deps, row);
          if (!saved.ok) return unavailable;
          summary.unknown = 1;
        }
      } catch {
        const saved = await unknown(deps, row);
        if (!saved.ok) return unavailable;
        summary.unknown = 1;
      }
      break; // Hard per-invocation provider budget, including failure/recovery.
    }
    return { ok: true, data: summary };
  } catch {
    return unavailable;
  }
}
