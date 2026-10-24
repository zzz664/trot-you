import { z } from 'zod';
import { artistSlugSchema } from './artists';

// Technical request/session limits, not commercial terms or price defaults.
export const CHECKOUT_NONCE_BYTES = 32;
export const CHECKOUT_BODY_LIMIT = 2048;
export const CHECKOUT_REQUEST_TIMEOUT_MS = 15_000;
export const CHECKOUT_NONCE_COOKIE = 'trot-checkout';
export const CHECKOUT_NONCE_MAX_AGE_SECONDS = 30 * 60;
export const CHECKOUT_INTENT_TTL_MS = 15 * 60 * 1000;
export const CHECKOUT_PROVIDERS = [
  'toss_card_billing',
  'kakaopay_subscription',
] as const;
export const checkoutProviderSchema = z.enum(CHECKOUT_PROVIDERS);
export type CheckoutProvider = z.output<typeof checkoutProviderSchema>;
export const checkoutInputSchema = z.strictObject({
  artistSlug: artistSlugSchema,
  provider: checkoutProviderSchema,
  policyVersion: z.uuid(),
  accepted: z.literal(true),
  idempotencyKey: z.uuid(),
});
export const checkoutCancelSchema = z.strictObject({ sessionId: z.uuid() });
export type CheckoutInput = z.output<typeof checkoutInputSchema>;
export type CheckoutCancelInput = z.output<typeof checkoutCancelSchema>;
export const CHECKOUT_ERROR_STATUS = {
  SETUP_NOT_READY: 503,
  INVALID_INPUT: 400,
  POLICY_CHANGED: 409,
  CONSENT_REQUIRED: 400,
  SUBSCRIPTION_EXISTS: 409,
  CHECKOUT_EXISTS: 409,
  SESSION_EXPIRED: 409,
  SESSION_CONSUMED: 409,
  FORBIDDEN: 403,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  UNAVAILABLE: 503,
  PROVIDER_NOT_READY: 503,
  COMPLETION_UNAVAILABLE: 503,
} as const;
export type CheckoutError = keyof typeof CHECKOUT_ERROR_STATUS;
export type CheckoutResult<T> =
  { ok: true; data: T } | { ok: false; code: CheckoutError };
export type CheckoutOffer = {
  artist: { slug: string; name: string };
  policy: {
    version: string;
    title: string;
    body: string;
    regularPriceKrw: number;
    introPriceKrw: number;
  };
  introEligible: boolean;
};
export type CheckoutPageData = {
  offer: CheckoutOffer;
  providers: { provider: CheckoutProvider; configured: boolean }[];
  launchAvailable: boolean;
};
export const checkoutIntentSchema = z.strictObject({
  id: z.uuid(),
  status: z.enum(['pending_intent', 'canceled', 'expired']),
  expiresAt: z.iso.datetime({ offset: true }),
  provider: checkoutProviderSchema,
  initialPriceKrw: z.number().int().nonnegative(),
  regularPriceKrw: z.number().int().positive(),
  introEligible: z.boolean(),
});
export type CheckoutIntent = z.output<typeof checkoutIntentSchema>;
