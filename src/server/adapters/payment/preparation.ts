import 'server-only';
import { z } from 'zod';
import { originSchema } from '@/config/env';
import { parseServerEnv, type ServerEnv } from '@/config/env.server';
import {
  PAYMENT_CALLBACK_MAX_LENGTH,
  PAYMENT_STATE_LENGTH,
} from '@/config/payment-preparation';
import { routes } from '@/config/routes';

export const preparationIdentitySchema = z.strictObject({
  sessionId: z.uuid(),
  customerRef: z.uuid(),
  orderId: z.uuid(),
  callbackState: z
    .string()
    .length(PAYMENT_STATE_LENGTH)
    .regex(/^[A-Za-z0-9_-]+$/),
});

// Only server-created random references may be supplied. Never a profile ID,
// name, email, phone, card data, authKey, pg_token, billing key or SID.
export type PreparationIdentity = z.output<typeof preparationIdentitySchema>;

// Revalidate mode/origin/key relationships at this external-I/O boundary. The
// central parser takes raw strings, whereas ServerEnv flags are transformed
// booleans; preserve that distinction rather than parsing its output directly.
export function parsePreparationEnvironment(env: ServerEnv) {
  return parseServerEnv({
    ...env,
    UI_PREVIEW_ENABLED: String(env.UI_PREVIEW_ENABLED),
    // Cron authorization is checked against raw runtime input at the worker
    // boundary. It is not a provider credential and must not be reparsed after
    // the private CI flags have deliberately been stripped from ServerEnv.
    PAYMENTS_RENEWALS_ENABLED: 'false',
    PAYMENTS_REFUNDS_ENABLED: 'false',
    PAYMENTS_RECONCILIATION_ENABLED: 'false',
    MESSAGE_DISPATCH_ENABLED: 'false',
    MESSAGE_DISPATCH_CRON_SECRET: undefined,
    RECONCILIATION_CRON_SECRET: undefined,
    RENEWAL_CRON_SECRET: undefined,
    TOSS_BILLING_ENABLED: String(env.TOSS_BILLING_ENABLED),
    KAKAOPAY_SUBSCRIPTION_ENABLED: String(env.KAKAOPAY_SUBSCRIPTION_ENABLED),
  });
}
export type PreparationError =
  | 'CONFIGURATION_INVALID'
  | 'INTEGRATION_UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'PROVIDER_REJECTED'
  | 'OUTCOME_UNKNOWN';
export type PreparationResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: PreparationError;
      outcome: 'not_started' | 'rejected' | 'unknown';
      retryAllowed: false;
    };

export function preparationFailure(
  code: PreparationError,
): PreparationResult<never> {
  return {
    ok: false,
    code,
    outcome:
      code === 'OUTCOME_UNKNOWN'
        ? 'unknown'
        : code === 'PROVIDER_REJECTED'
          ? 'rejected'
          : 'not_started',
    retryAllowed: false,
  };
}

export function preparationCallbacks(
  origin: string,
  identity: PreparationIdentity,
) {
  const parsed = originSchema.safeParse(origin);
  const parsedIdentity = preparationIdentitySchema.safeParse(identity);
  if (!parsed.success || !parsedIdentity.success) return null;
  const create = (outcome: 'success' | 'failure' | 'cancel') => {
    const url = new URL(routes.checkoutReturn, parsed.data);
    url.searchParams.set('session', parsedIdentity.data.sessionId);
    url.searchParams.set('state', parsedIdentity.data.callbackState);
    url.searchParams.set('outcome', outcome);
    return url.href;
  };
  const urls = {
    successUrl: create('success'),
    failUrl: create('failure'),
    cancelUrl: create('cancel'),
  };
  return Object.values(urls).every(
    (value) => value.length <= PAYMENT_CALLBACK_MAX_LENGTH,
  )
    ? urls
    : null;
}
