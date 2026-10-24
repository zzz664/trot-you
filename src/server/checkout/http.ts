import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { AUTH_PRIVATE_HEADERS, AUTH_REDIRECT_STATUS } from '@/config/auth';
import {
  CHECKOUT_BODY_LIMIT,
  CHECKOUT_ERROR_STATUS,
  CHECKOUT_NONCE_COOKIE,
  CHECKOUT_NONCE_MAX_AGE_SECONDS,
  CHECKOUT_NONCE_BYTES,
  checkoutCancelSchema,
  checkoutInputSchema,
  type CheckoutIntent,
  type CheckoutResult,
} from '@/config/checkout';
import { getServerEnv } from '@/config/env.server';
import { routes } from '@/config/routes';
import { createAuthContext } from '@/server/auth/context';
import { createCheckoutSessionPort } from '@/server/db/checkout';
import { createCheckoutServiceClient } from '@/server/db/checkout-client';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import {
  cancelCheckout,
  prepareCheckout,
} from '@/server/services/checkout/sessions';
import { checkoutEnvironment } from './configuration';

const nonceCookieSchema = z.strictObject({
  actorId: z.uuid(),
  requestId: z.uuid(),
  sessionId: z.uuid(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
function readNonceCookie(request: NextRequest) {
  try {
    const raw = request.cookies.get(CHECKOUT_NONCE_COOKIE)?.value;
    if (!raw || raw.length > CHECKOUT_BODY_LIMIT) return null;
    const parsed = nonceCookieSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function hashNonce(nonce: string) {
  return createHash('sha256').update(nonce).digest('hex');
}
async function boundedJson(request: NextRequest): Promise<unknown> {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim() !==
    'application/json'
  )
    throw new Error('INVALID_INPUT');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('INVALID_INPUT');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > CHECKOUT_BODY_LIMIT) {
        await reader.cancel();
        throw new Error('INVALID_INPUT');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export async function checkoutPost(
  request: NextRequest,
  action: 'prepare' | 'cancel' = 'prepare',
) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: CheckoutResult<CheckoutIntent>) =>
    context.apply(
      NextResponse.json(result, {
        ...(result.ok ? {} : { status: CHECKOUT_ERROR_STATUS[result.code] }),
      }),
    );
  if (!context.configuration || !context.client || !context.port)
    return respond({ ok: false, code: 'SETUP_NOT_READY' });
  if (
    !isSameOriginPost(
      request.headers.get('origin'),
      context.configuration.appOrigin,
    )
  )
    return respond({ ok: false, code: 'FORBIDDEN' });
  const state = await readSession(context.port);
  if (state.status !== 'authenticated')
    return respond({
      ok: false,
      code: state.status === 'unavailable' ? 'UNAVAILABLE' : 'UNAUTHENTICATED',
    });
  if (
    isRestricted(state.profile) ||
    state.profile.role !== 'fan' ||
    !state.profile.onboarding_completed_at
  )
    return respond({ ok: false, code: 'FORBIDDEN' });
  let body: unknown;
  try {
    body = await boundedJson(request);
  } catch {
    return respond({ ok: false, code: 'INVALID_INPUT' });
  }
  const cookie = readNonceCookie(request);
  const service = createCheckoutServiceClient();
  if (!service) return respond({ ok: false, code: 'SETUP_NOT_READY' });
  const port = createCheckoutSessionPort(service);
  const cookieOptions = {
    path: routes.checkoutSubmit,
    // A top-level provider callback needs this cookie; every mutation still
    // requires an exact same-origin POST and verified actor/session binding.
    sameSite: 'lax' as const,
    httpOnly: true,
    secure: new URL(context.configuration.appOrigin).protocol === 'https:',
    maxAge: CHECKOUT_NONCE_MAX_AGE_SECONDS,
  };
  if (action === 'cancel') {
    const input = checkoutCancelSchema.safeParse(body);
    if (!input.success) return respond({ ok: false, code: 'INVALID_INPUT' });
    if (
      !cookie ||
      cookie.actorId !== state.profile.id ||
      cookie.sessionId !== input.data.sessionId
    )
      return respond({ ok: false, code: 'FORBIDDEN' });
    const result = await cancelCheckout(
      port,
      state.profile.id,
      input.data,
      hashNonce(cookie.nonce),
    );
    const response = respond(result);
    if (result.ok)
      response.cookies.set(CHECKOUT_NONCE_COOKIE, '', {
        ...cookieOptions,
        maxAge: 0,
      });
    return response;
  }
  const input = checkoutInputSchema.safeParse(body);
  if (!input.success) return respond({ ok: false, code: 'INVALID_INPUT' });
  const nonce =
    cookie?.actorId === state.profile.id &&
    cookie.requestId === input.data.idempotencyKey
      ? cookie.nonce
      : randomBytes(CHECKOUT_NONCE_BYTES).toString('base64url');
  const result = await prepareCheckout(
    port,
    state.profile.id,
    input.data,
    checkoutEnvironment(input.data.provider),
    hashNonce(nonce),
  );
  const response = respond(result);
  if (result.ok)
    response.cookies.set(
      CHECKOUT_NONCE_COOKIE,
      JSON.stringify({
        actorId: state.profile.id,
        requestId: input.data.idempotencyKey,
        sessionId: result.data.id,
        nonce,
      }),
      cookieOptions,
    );
  return response;
}

// Provider authorization is intentionally NOT accepted yet. Never mutate on a
// GET, exchange authKey/pg_token, store query values, or forward an arbitrary URL.
// Strip every query parameter immediately, before rendering an app document.
export function checkoutReturn() {
  const parsed = getServerEnv();
  if (!parsed.ok)
    return NextResponse.json(
      { ok: false, code: 'COMPLETION_UNAVAILABLE' },
      {
        status: CHECKOUT_ERROR_STATUS.COMPLETION_UNAVAILABLE,
        headers: AUTH_PRIVATE_HEADERS,
      },
    );
  const response = NextResponse.redirect(
    new URL(routes.checkout, parsed.data.NEXT_PUBLIC_APP_URL),
    { status: AUTH_REDIRECT_STATUS },
  );
  for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
    response.headers.set(key, value);
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'",
  );
  return response;
}
