import { z } from 'zod';
import {
  CHECKOUT_ERROR_STATUS,
  CHECKOUT_REQUEST_TIMEOUT_MS,
  CHECKOUT_INTENT_TTL_MS,
  checkoutCancelSchema,
  checkoutInputSchema,
  checkoutIntentSchema,
  type CheckoutCancelInput,
  type CheckoutError,
  type CheckoutInput,
  type CheckoutIntent,
  type CheckoutResult,
} from '@/config/checkout';
import { routes } from '@/config/routes';

const resultSchema = z.union([
  z.strictObject({ ok: z.literal(true), data: checkoutIntentSchema }),
  z.strictObject({ ok: z.literal(false), code: z.string() }),
]);

async function post(
  path: string,
  input: CheckoutInput | CheckoutCancelInput,
): Promise<CheckoutResult<CheckoutIntent>> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(CHECKOUT_REQUEST_TIMEOUT_MS),
    });
    const parsed = resultSchema.safeParse(await response.json());
    if (!parsed.success) return { ok: false, code: 'UNAVAILABLE' };
    const result = parsed.data;
    if (result.ok) {
      if (!response.ok) return { ok: false, code: 'UNAVAILABLE' };
      if (
        'sessionId' in input
          ? result.data.id !== input.sessionId ||
            result.data.status !== 'canceled'
          : result.data.provider !== input.provider ||
            result.data.status !== 'pending_intent'
      )
        return { ok: false, code: 'UNAVAILABLE' };
      return result;
    }
    if (Object.hasOwn(CHECKOUT_ERROR_STATUS, result.code))
      return { ok: false, code: result.code as CheckoutError };
  } catch {
    // A lost response may follow a committed intent. Never log provider/user
    // data or create a new idempotency key and blindly replay an uncertain write.
  }
  return { ok: false, code: 'UNAVAILABLE' };
}

export async function prepareCheckout(
  input: CheckoutInput,
): Promise<CheckoutResult<CheckoutIntent>> {
  const parsed = checkoutInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  return post(routes.checkoutSubmit, parsed.data);
}

export async function cancelCheckout(
  input: CheckoutCancelInput,
): Promise<CheckoutResult<CheckoutIntent>> {
  const parsed = checkoutCancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  return post(routes.checkoutCancel, parsed.data);
}

// A local display timer is not a server status read or an expiry mutation.
export function checkoutExpiryDelay(expiresAt: string, now = Date.now()) {
  const remaining = Date.parse(expiresAt) - now;
  return Number.isFinite(remaining)
    ? Math.min(CHECKOUT_INTENT_TTL_MS, Math.max(0, remaining))
    : 0;
}
