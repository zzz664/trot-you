import 'server-only';
import { z } from 'zod';
import {
  enrollmentConfirmSchema,
  enrollmentSessionSchema,
  type EnrollmentResult,
  type EnrollmentStatus,
  type EnrollmentStart,
  type EnrollmentLaunch,
} from '@/config/enrollment';
import type { CheckoutProvider } from '@/config/checkout';
import { PAYMENT_STATE_LENGTH } from '@/config/payment-preparation';
import { initialBillingPeriod } from '@/lib/billing-period';
import type { CheckoutSessionPort } from '@/server/services/checkout/sessions';
import type {
  KakaoEnrollmentAdapter,
  TossEnrollmentAdapter,
  VerifiedInitialCharge,
} from '@/server/adapters/payment/enrollment';
import { providerSecretSchema } from '@/server/adapters/payment/enrollment';
import type {
  PaymentVault,
  PaymentVaultBinding,
  PaymentVaultEnvelope,
} from '@/server/adapters/payment/vault';
import type {
  PreparationIdentity,
  PreparationResult,
} from '@/server/adapters/payment/preparation';
import type { TossBillingAuthPreparation } from '@/server/adapters/payment/toss';
import {
  enrollmentActorSchema,
  publicEnrollment,
  type EnrollmentActor,
  type EnrollmentDbPort,
  type PrivateEnrollment,
} from './model';

export type EnrollmentDependencies = {
  db: EnrollmentDbPort;
  checkout: CheckoutSessionPort;
  vault: PaymentVault;
  toss: TossEnrollmentAdapter;
  kakao: KakaoEnrollmentAdapter;
  configuration(
    provider: CheckoutProvider,
  ): { environment: 'test' | 'live'; merchant: string } | null;
  prepareToss(
    identity: PreparationIdentity,
  ): PreparationResult<TossBillingAuthPreparation>;
  evidenceRef(): string;
  now(): Date;
  recovery?: {
    recover(
      actorId: string,
      sessionId: string,
    ): Promise<EnrollmentResult<null>>;
  };
};
const unavailable: EnrollmentResult<never> = { ok: false, code: 'UNAVAILABLE' };
const forbidden: EnrollmentResult<never> = { ok: false, code: 'FORBIDDEN' };
const callbackSchema = z.discriminatedUnion('provider', [
  z.strictObject({
    provider: z.literal('toss'),
    authKey: providerSecretSchema,
    customerKey: z.uuid(),
  }),
  z.strictObject({
    provider: z.literal('kakaopay'),
    pgToken: providerSecretSchema,
  }),
]);
export type EnrollmentCallback = z.output<typeof callbackSchema>;
function providerOf(row: PrivateEnrollment): CheckoutProvider {
  return row.provider === 'toss'
    ? 'toss_card_billing'
    : 'kakaopay_subscription';
}
function configured(deps: EnrollmentDependencies, row: PrivateEnrollment) {
  const config = deps.configuration(providerOf(row));
  return (
    config?.environment === row.environment &&
    config.merchant === row.merchant_account
  );
}
function binding(
  row: PrivateEnrollment,
  purpose: PaymentVaultBinding['purpose'],
): PaymentVaultBinding {
  return {
    actorId: row.user_id,
    artistId: row.artist_id,
    provider: providerOf(row),
    environment: row.environment,
    mandateId: row.mandate_id,
    purpose,
  };
}
function projection(
  result: EnrollmentResult<PrivateEnrollment>,
): EnrollmentResult<EnrollmentStatus> {
  return result.ok ? { ok: true, data: publicEnrollment(result.data) } : result;
}
function validActor(actor: EnrollmentActor) {
  return enrollmentActorSchema.safeParse(actor).success;
}
function validPayment(row: PrivateEnrollment, charge: VerifiedInitialCharge) {
  return (
    charge.customerRef === row.customer_ref &&
    charge.orderId === row.order_id &&
    charge.amountKrw === row.initial_price_krw &&
    charge.currency === 'KRW' &&
    charge.merchantAccount === row.merchant_account
  );
}
async function outcome(
  deps: EnrollmentDependencies,
  row: PrivateEnrollment,
  rejected = false,
) {
  if (!row.lease_token) return unavailable;
  return projection(
    await deps.db.recordOutcome(
      row.user_id,
      row.session_id,
      row.lease_token,
      rejected ? 'failed' : 'unknown',
      deps.evidenceRef(),
    ),
  );
}
// A verified response may outlive a lost database reply. Observe the durable
// state first, then make at most one exact idempotent database-only replay while
// the verified result (including Kakao SID envelope) is still held in memory.
// This never repeats any provider request or generates new payment identity.
async function finalizeVerified(
  deps: EnrollmentDependencies,
  actor: EnrollmentActor,
  row: PrivateEnrollment,
  charge: VerifiedInitialCharge,
  credential: PaymentVaultEnvelope | null,
): Promise<EnrollmentResult<EnrollmentStatus>> {
  const evidence = deps.evidenceRef();
  let saved: EnrollmentResult<PrivateEnrollment>;
  try {
    saved = await deps.db.finalize(
      actor.actorId,
      row.session_id,
      charge,
      evidence,
      credential,
    );
  } catch {
    saved = unavailable;
  }
  if (saved.ok || saved.code !== 'UNAVAILABLE') return projection(saved);
  const observed = await deps.db.read(actor, row.session_id);
  if (!observed.ok) return observed;
  if (observed.data.public_status === 'succeeded') return projection(observed);
  if (
    !['processing', 'unknown', 'manual_review'].includes(
      observed.data.public_status,
    )
  )
    return unavailable;
  return projection(
    await deps.db.finalize(
      actor.actorId,
      row.session_id,
      charge,
      evidence,
      credential,
    ),
  );
}
function startResult(
  row: PrivateEnrollment,
  launch?: EnrollmentLaunch,
): EnrollmentResult<EnrollmentStart> {
  return {
    ok: true,
    data: { status: publicEnrollment(row), ...(launch ? { launch } : {}) },
  };
}

export async function startEnrollment(
  deps: EnrollmentDependencies,
  actor: EnrollmentActor,
  input: unknown,
  callbackState: string,
  callbackStateHash: string,
): Promise<EnrollmentResult<EnrollmentStart>> {
  const parsed = enrollmentSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  if (
    !validActor(actor) ||
    !new RegExp(`^[A-Za-z0-9_-]{${PAYMENT_STATE_LENGTH}}$`).test(callbackState)
  )
    return forbidden;
  try {
    const checkout = await deps.checkout.read(
      actor.actorId,
      parsed.data.sessionId,
    );
    if (!checkout.ok) return checkout;
    const config = deps.configuration(checkout.data.provider);
    if (!config) return { ok: false, code: 'PROVIDER_NOT_READY' };
    const started = await deps.db.start(
      actor,
      parsed.data.sessionId,
      callbackStateHash,
      config.merchant,
    );
    if (!started.ok) return started;
    let row = started.data;
    if (!configured(deps, row))
      return { ok: false, code: 'PROVIDER_NOT_READY' };
    const identity = {
      sessionId: row.session_id,
      customerRef: row.customer_ref,
      orderId: row.order_id,
      callbackState,
    };
    if (row.provider === 'toss') {
      if (row.public_status !== 'awaiting_authorization')
        return startResult(row);
      const prepared = deps.prepareToss(identity);
      if (!prepared.ok) return { ok: false, code: 'PROVIDER_NOT_READY' };
      const { kind, sdkUrl, clientKey, payment, requestBillingAuth } =
        prepared.data;
      return startResult(row, {
        kind,
        sdkUrl,
        clientKey,
        payment,
        requestBillingAuth,
      });
    }
    if (row.state === 'ready') {
      const claimed = await deps.db.claim(actor, row.session_id, 'ready');
      if (!claimed.ok) return claimed;
      row = claimed.data;
      if (!row.dispatch || !row.lease_token) return startResult(row);
      const ready = await deps.kakao.ready({
        ...identity,
        amountKrw: row.initial_price_krw,
      });
      if (!ready.ok) {
        const result = await outcome(deps, row, ready.outcome === 'rejected');
        return result.ok ? { ok: true, data: { status: result.data } } : result;
      }
      const encrypted = deps.vault.seal(
        JSON.stringify(ready.data.redirects),
        binding(row, 'ready'),
      );
      const recorded = await deps.db.recordReady(
        actor.actorId,
        row.session_id,
        row.lease_token,
        ready.data.tid,
        encrypted,
      );
      if (!recorded.ok) return recorded;
      row = recorded.data;
    }
    if (row.public_status !== 'awaiting_authorization' || !row.redirects)
      return startResult(row);
    const redirects = z
      .strictObject({ mobile: z.url(), desktop: z.url() })
      .parse(JSON.parse(deps.vault.open(row.redirects, binding(row, 'ready'))));
    // Both documented device handoffs are validated before encrypted storage.
    // The browser selects only between these bound provider URLs.
    return startResult(row, {
      kind: 'kakaopay_redirect',
      redirectUrl: redirects.mobile,
      desktopRedirectUrl: redirects.desktop,
    });
  } catch {
    return unavailable;
  }
}

// This function captures authorization only. It performs no provider request,
// credential exchange, charge, paid-state transition or financial finalization.
export async function captureEnrollment(
  deps: EnrollmentDependencies,
  actor: EnrollmentActor,
  sessionId: string,
  callbackStateHash: string,
  input: unknown,
): Promise<EnrollmentResult<EnrollmentStatus>> {
  const callback = callbackSchema.safeParse(input);
  if (!callback.success || !z.uuid().safeParse(sessionId).success)
    return { ok: false, code: 'INVALID_INPUT' };
  if (!validActor(actor)) return forbidden;
  try {
    const read = await deps.db.read(actor, sessionId);
    if (!read.ok) return read;
    const row = read.data;
    if (!configured(deps, row))
      return { ok: false, code: 'PROVIDER_NOT_READY' };
    if (
      callback.data.provider !== row.provider ||
      (callback.data.provider === 'toss' &&
        callback.data.customerKey !== row.customer_ref)
    )
      return forbidden;
    const ciphertext = deps.vault.seal(
      JSON.stringify(callback.data),
      binding(row, 'callback'),
    );
    return projection(
      await deps.db.capture(actor, sessionId, callbackStateHash, ciphertext),
    );
  } catch {
    return unavailable;
  }
}

export async function confirmEnrollment(
  deps: EnrollmentDependencies,
  actor: EnrollmentActor,
  input: unknown,
): Promise<EnrollmentResult<EnrollmentStatus>> {
  const parsed = enrollmentConfirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  if (!validActor(actor)) return forbidden;
  try {
    const read = await deps.db.read(actor, parsed.data.sessionId);
    if (!read.ok) return read;
    let row = read.data;
    if (!configured(deps, row))
      return { ok: false, code: 'PROVIDER_NOT_READY' };
    if (
      parsed.data.policyVersion !== row.policy_version ||
      parsed.data.amountKrw !== row.initial_price_krw
    )
      return { ok: false, code: 'POLICY_CHANGED' };
    if (row.public_status !== 'awaiting_confirmation')
      return { ok: true, data: publicEnrollment(row) };
    if (row.provider === 'toss' && !row.credential_ciphertext) {
      // Local vault preflight precedes the irreversible dispatch claim. A bad
      // key/version cannot create an artificial unknown provider operation.
      if (!row.callback_ciphertext) return unavailable;
      const callback = callbackSchema.parse(
        JSON.parse(
          deps.vault.open(row.callback_ciphertext, binding(row, 'callback')),
        ),
      );
      if (
        callback.provider !== 'toss' ||
        callback.customerKey !== row.customer_ref
      )
        return unavailable;
      const claimed = await deps.db.claim(actor, row.session_id, 'exchange');
      if (!claimed.ok) return claimed;
      row = claimed.data;
      if (!row.dispatch || !row.lease_token)
        return { ok: true, data: publicEnrollment(row) };
      const exchanged = await deps.toss.exchange({
        customerRef: row.customer_ref,
        authKey: callback.authKey,
        idempotencyKey: row.session_id,
      });
      if (!exchanged.ok)
        return await outcome(deps, row, exchanged.outcome === 'rejected');
      if (
        exchanged.data.customerRef !== row.customer_ref ||
        exchanged.data.merchantAccount !== row.merchant_account
      )
        return await outcome(deps, row);
      const encrypted = deps.vault.seal(
        exchanged.data.credential,
        binding(row, 'credential'),
      );
      const saved = await deps.db.recordCredential(
        actor.actorId,
        row.session_id,
        row.lease_token,
        encrypted,
      );
      if (!saved.ok) return saved;
      row = saved.data;
    }
    const credential =
      row.provider === 'toss' && row.credential_ciphertext
        ? deps.vault.open(row.credential_ciphertext, binding(row, 'credential'))
        : null;
    const callback =
      row.provider === 'kakaopay' && row.callback_ciphertext
        ? callbackSchema.parse(
            JSON.parse(
              deps.vault.open(
                row.callback_ciphertext,
                binding(row, 'callback'),
              ),
            ),
          )
        : null;
    if (
      (row.provider === 'toss' && !credential) ||
      (row.provider === 'kakaopay' &&
        (!row.tid || callback?.provider !== 'kakaopay'))
    )
      return unavailable;
    const period =
      row.period_start && row.period_end
        ? { start: row.period_start, end: row.period_end }
        : initialBillingPeriod(deps.now(), row.billing_period_calendar);
    const claimed = await deps.db.claim(
      actor,
      row.session_id,
      row.provider === 'toss' ? 'charge' : 'approve',
      {
        accepted: true,
        policyVersion: parsed.data.policyVersion,
        amountKrw: parsed.data.amountKrw,
        periodStart: period.start,
        periodEnd: period.end,
      },
    );
    if (!claimed.ok) return claimed;
    row = claimed.data;
    if (!row.dispatch || !row.lease_token)
      return { ok: true, data: publicEnrollment(row) };
    const identity = {
      customerRef: row.customer_ref,
      orderId: row.order_id,
      amountKrw: row.initial_price_krw,
    };
    if (row.provider === 'toss') {
      if (!credential) return await outcome(deps, row);
      const result = await deps.toss.charge({
        ...identity,
        credential,
        idempotencyKey: row.order_id,
      });
      if (!result.ok)
        return await outcome(deps, row, result.outcome === 'rejected');
      if (!validPayment(row, result.data)) return await outcome(deps, row);
      return await finalizeVerified(deps, actor, row, result.data, null);
    }
    if (!row.tid || callback?.provider !== 'kakaopay')
      return await outcome(deps, row);
    const result = await deps.kakao.approve({
      ...identity,
      tid: row.tid,
      pgToken: callback.pgToken,
    });
    if (!result.ok)
      return await outcome(deps, row, result.outcome === 'rejected');
    if (!validPayment(row, result.data.charge)) return await outcome(deps, row);
    const encrypted = deps.vault.seal(
      result.data.credential,
      binding(row, 'credential'),
    );
    return await finalizeVerified(
      deps,
      actor,
      row,
      result.data.charge,
      encrypted,
    );
  } catch {
    return unavailable;
  }
}

export async function readEnrollment(
  deps: Pick<EnrollmentDependencies, 'db'>,
  actor: Pick<EnrollmentActor, 'actorId' | 'authSessionHash'>,
  input: unknown,
): Promise<EnrollmentResult<EnrollmentStatus>> {
  const parsed = enrollmentSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    return projection(await deps.db.read(actor, parsed.data.sessionId));
  } catch {
    return unavailable;
  }
}
export async function cancelEnrollment(
  deps: Pick<EnrollmentDependencies, 'db'>,
  actor: EnrollmentActor,
  input: unknown,
): Promise<EnrollmentResult<EnrollmentStatus>> {
  const parsed = enrollmentSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  if (!validActor(actor)) return forbidden;
  try {
    return projection(await deps.db.cancel(actor, parsed.data.sessionId));
  } catch {
    return unavailable;
  }
}
export async function reconcileEnrollment(
  deps: EnrollmentDependencies,
  actor: EnrollmentActor,
  input: unknown,
): Promise<EnrollmentResult<EnrollmentStatus>> {
  const parsed = enrollmentSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  if (!validActor(actor)) return forbidden;
  try {
    const read = await deps.db.read(actor, parsed.data.sessionId);
    if (!read.ok) return read;
    const row = read.data;
    if (
      row.session_id !== parsed.data.sessionId ||
      row.user_id !== actor.actorId
    )
      return unavailable;
    if (!configured(deps, row))
      return { ok: false, code: 'PROVIDER_NOT_READY' };
    if (!publicEnrollment(row).canReconcile)
      return { ok: true, data: publicEnrollment(row) };
    if (!deps.recovery) return unavailable;
    const recovered = await deps.recovery.recover(row.user_id, row.session_id);
    if (!recovered.ok) return recovered;
    // The same bounded case/lease used by the worker owns query and settlement.
    // Refresh the actor-bound projection; never expose private recovery facts.
    const refreshed = await deps.db.read(actor, row.session_id);
    if (!refreshed.ok) return refreshed;
    if (
      refreshed.data.session_id !== row.session_id ||
      refreshed.data.user_id !== actor.actorId
    )
      return unavailable;
    return projection(refreshed);
  } catch {
    return unavailable;
  }
}
