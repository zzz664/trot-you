import 'server-only';
import type { ActorClient } from './client';
import type { CheckoutServiceClient } from './checkout-client';
import type { Database } from '@/types/database';
import {
  checkoutIntentSchema,
  type CheckoutError,
  type CheckoutResult,
} from '@/config/checkout';
import type {
  CheckoutOfferPort,
  CheckoutSessionPort,
  PrivateCheckoutSession,
} from '@/server/services/checkout/sessions';

function databaseError(message: string): CheckoutResult<never> {
  const errors: Record<string, CheckoutError> = {
    CHECKOUT_INVALID_INPUT: 'INVALID_INPUT',
    CHECKOUT_ACTOR_FORBIDDEN: 'FORBIDDEN',
    CHECKOUT_ONBOARDING_REQUIRED: 'FORBIDDEN',
    DISCOVERY_FORBIDDEN: 'FORBIDDEN',
    DISCOVERY_PROFILE_REQUIRED: 'FORBIDDEN',
    DISCOVERY_SETUP_NOT_READY: 'SETUP_NOT_READY',
    CHECKOUT_PROFILE_REQUIRED: 'FORBIDDEN',
    CHECKOUT_SETUP_NOT_READY: 'SETUP_NOT_READY',
    CHECKOUT_POLICY_CHANGED: 'POLICY_CHANGED',
    CHECKOUT_CONSENT_REQUIRED: 'CONSENT_REQUIRED',
    CHECKOUT_NOT_FOUND: 'NOT_FOUND',
    CHECKOUT_SUBSCRIPTION_EXISTS: 'SUBSCRIPTION_EXISTS',
    CHECKOUT_SESSION_EXISTS: 'CHECKOUT_EXISTS',
    CHECKOUT_IDEMPOTENCY_CONFLICT: 'CHECKOUT_EXISTS',
    CHECKOUT_NONCE_INVALID: 'FORBIDDEN',
    CHECKOUT_SESSION_REPLAY: 'SESSION_CONSUMED',
    CHECKOUT_SESSION_EXPIRED: 'SESSION_EXPIRED',
  };
  return {
    ok: false,
    code: Object.hasOwn(errors, message) ? errors[message]! : 'UNAVAILABLE',
  };
}

type SessionRow =
  Database['public']['Functions']['checkout_read_session']['Returns'][number];
function session(
  row: SessionRow | null,
): CheckoutResult<PrivateCheckoutSession> {
  if (!row) return { ok: false, code: 'UNAVAILABLE' };
  const parsed = checkoutIntentSchema.safeParse({
    id: row.session_id,
    status: row.status,
    provider:
      row.provider === 'toss'
        ? 'toss_card_billing'
        : row.provider === 'kakaopay'
          ? 'kakaopay_subscription'
          : null,
    expiresAt: row.expires_at,
    initialPriceKrw: row.initial_price_krw,
    regularPriceKrw: row.regular_price_krw,
    introEligible: row.intro_eligible,
  });
  if (!parsed.success) return { ok: false, code: 'UNAVAILABLE' };
  return {
    ok: true,
    data: { ...parsed.data, nonceMatches: row.nonce_matches === true },
  };
}

export function createCheckoutOfferPort(
  client: ActorClient,
): CheckoutOfferPort {
  return {
    async read(slug) {
      const { data, error } = await client
        .rpc('checkout_get_offer', { p_artist_slug: slug })
        .single();
      if (error) return databaseError(error.message);
      if (!data) return { ok: false, code: 'UNAVAILABLE' };
      return {
        ok: true,
        data: {
          artist: { slug: data.artist_slug, name: data.artist_name },
          policy: {
            version: data.policy_version,
            title: data.policy_title,
            body: data.policy_body,
            regularPriceKrw: data.regular_price_krw,
            introPriceKrw: data.intro_price_krw,
          },
          introEligible: data.intro_eligible,
        },
      };
    },
  };
}

export function createCheckoutSessionPort(
  client: CheckoutServiceClient,
): CheckoutSessionPort {
  return {
    async prepare(actorId, input, environment, nonceHash) {
      // A fresh explicit preparation may safely retire only expired, uncharged
      // idle enrollment owned by this actor. This cannot resume or erase any
      // processing/unknown financial operation and does not rebind its session.
      const abandoned = await client.rpc('enrollment_abandon_expired', {
        p_user_id: actorId,
        p_artist_slug: input.artistSlug,
      });
      if (abandoned.error) return databaseError(abandoned.error.message);
      const { data, error } = await client
        .rpc('checkout_prepare_session', {
          p_user_id: actorId,
          p_artist_slug: input.artistSlug,
          p_provider:
            input.provider === 'toss_card_billing' ? 'toss' : 'kakaopay',
          p_environment: environment,
          p_idempotency_key: input.idempotencyKey,
          p_nonce_hash: nonceHash,
          p_policy_version: input.policyVersion,
          p_terms_accepted: input.accepted,
        })
        .single();
      return error ? databaseError(error.message) : session(data);
    },
    async read(actorId, sessionId) {
      const { data, error } = await client
        .rpc('checkout_read_session', {
          p_user_id: actorId,
          p_session_id: sessionId,
        })
        .single();
      return error ? databaseError(error.message) : session(data);
    },
    async cancel(actorId, sessionId, nonceHash) {
      const { error } = await client.rpc('checkout_cancel_session', {
        p_user_id: actorId,
        p_session_id: sessionId,
        p_nonce_hash: nonceHash,
      });
      return error ? databaseError(error.message) : { ok: true, data: null };
    },
  };
}
