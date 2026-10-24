import 'server-only';
import { z } from 'zod';
import { artistSlugSchema } from '@/config/artists';
import {
  checkoutCancelSchema,
  checkoutInputSchema,
  type CheckoutInput,
  type CheckoutIntent,
  type CheckoutOffer,
  type CheckoutProvider,
  type CheckoutResult,
} from '@/config/checkout';

export type CheckoutOfferPort = {
  read(slug: string): Promise<CheckoutResult<CheckoutOffer>>;
};
export type PrivateCheckoutSession = {
  id: string;
  status: CheckoutIntent['status'];
  provider: CheckoutProvider;
  expiresAt: string;
  nonceMatches: boolean;
  initialPriceKrw: number;
  regularPriceKrw: number;
  introEligible: boolean;
};
export type CheckoutSessionPort = {
  prepare(
    actorId: string,
    input: CheckoutInput,
    environment: 'test' | 'live',
    nonceHash: string,
  ): Promise<CheckoutResult<PrivateCheckoutSession>>;
  read(
    actorId: string,
    sessionId: string,
  ): Promise<CheckoutResult<PrivateCheckoutSession>>;
  cancel(
    actorId: string,
    sessionId: string,
    nonceHash: string,
  ): Promise<CheckoutResult<null>>;
};

// This projection is deliberately unable to expose provider keys, TID, tokens,
// customer/order identifiers, nonce hashes, raw errors or credential references.
function publicIntent(session: PrivateCheckoutSession): CheckoutIntent {
  return {
    id: session.id,
    status: session.status,
    provider: session.provider,
    expiresAt: session.expiresAt,
    initialPriceKrw: session.initialPriceKrw,
    regularPriceKrw: session.regularPriceKrw,
    introEligible: session.introEligible,
  };
}

export async function readCheckoutOffer(
  port: CheckoutOfferPort,
  slug: unknown,
): Promise<CheckoutResult<CheckoutOffer>> {
  const parsed = artistSlugSchema.safeParse(slug);
  if (!parsed.success) return { ok: false, code: 'NOT_FOUND' };
  try {
    return await port.read(parsed.data);
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}

export async function prepareCheckout(
  port: CheckoutSessionPort,
  actorId: string,
  input: unknown,
  environment: 'test' | 'live' | null,
  nonceHash: string,
): Promise<CheckoutResult<CheckoutIntent>> {
  const parsed = checkoutInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  if (!z.uuid().safeParse(actorId).success || !/^[a-f0-9]{64}$/.test(nonceHash))
    return { ok: false, code: 'FORBIDDEN' };
  if (!environment) return { ok: false, code: 'PROVIDER_NOT_READY' };
  try {
    const result = await port.prepare(
      actorId,
      parsed.data,
      environment,
      nonceHash,
    );
    if (!result.ok) return result;
    // A lost first response cannot recover the one-time browser nonce. Do not
    // replace that nonce, dispatch again, or pretend a new attempt was made.
    if (!result.data.nonceMatches)
      return { ok: false, code: 'CHECKOUT_EXISTS' };
    if (result.data.status === 'expired')
      return { ok: false, code: 'SESSION_EXPIRED' };
    if (result.data.status !== 'pending_intent')
      return { ok: false, code: 'SESSION_CONSUMED' };
    return { ok: true, data: publicIntent(result.data) };
  } catch {
    // Unknown transport outcome is not proof that the durable intent failed.
    return { ok: false, code: 'UNAVAILABLE' };
  }
}

export async function cancelCheckout(
  port: CheckoutSessionPort,
  actorId: string,
  input: unknown,
  nonceHash: string,
): Promise<CheckoutResult<CheckoutIntent>> {
  const parsed = checkoutCancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  if (!z.uuid().safeParse(actorId).success || !/^[a-f0-9]{64}$/.test(nonceHash))
    return { ok: false, code: 'FORBIDDEN' };
  try {
    const canceled = await port.cancel(
      actorId,
      parsed.data.sessionId,
      nonceHash,
    );
    if (!canceled.ok) return canceled;
    const result = await port.read(actorId, parsed.data.sessionId);
    if (!result.ok) return result;
    return result.data.status === 'canceled'
      ? { ok: true, data: publicIntent(result.data) }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
