import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { AUTH_PRIVATE_HEADERS, AUTH_REDIRECT_STATUS } from '@/config/auth';
import { CHECKOUT_ERROR_STATUS, type CheckoutResult } from '@/config/checkout';
import { enrollmentSessionSchema } from '@/config/enrollment';
import { routes, enrollmentCompletePath } from '@/config/routes';
import { getServerEnv } from '@/config/env.server';
import {
  PAYMENT_STATE_LENGTH,
  PAYMENT_HTTP_OK,
} from '@/config/payment-preparation';
import { createAuthContext } from '@/server/auth/context';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import {
  cancelEnrollment,
  captureEnrollment,
  confirmEnrollment,
  readEnrollment,
  reconcileEnrollment,
  startEnrollment,
} from '@/server/services/enrollment/flow';
import {
  createEnrollmentDependencies,
  createEnrollmentDatabaseDependencies,
} from './dependencies';
import {
  enrollmentCallbackState,
  enrollmentHash,
  enrollmentJson,
  readEnrollmentNonce,
  verifiedAuthSessionHash,
} from './security';

type Action = 'start' | 'confirm' | 'cancel' | 'reconcile';
export async function enrollmentPost(request: NextRequest, action: Action) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: CheckoutResult<unknown>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok
          ? PAYMENT_HTTP_OK
          : CHECKOUT_ERROR_STATUS[result.code],
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
  // A restricted owner may abandon an uncharged local operation, but cannot
  // register, confirm, or initiate new provider work.
  if (
    (action === 'start' || action === 'confirm') &&
    (isRestricted(state.profile) ||
      state.profile.role !== 'fan' ||
      !state.profile.onboarding_completed_at)
  )
    return respond({ ok: false, code: 'FORBIDDEN' });
  let body: unknown;
  try {
    body = await enrollmentJson(request);
  } catch {
    return respond({ ok: false, code: 'INVALID_INPUT' });
  }
  const session = z.object({ sessionId: z.uuid() }).safeParse(body);
  if (!session.success) return respond({ ok: false, code: 'INVALID_INPUT' });
  const nonce = readEnrollmentNonce(request);
  if (
    !nonce ||
    nonce.actorId !== state.profile.id ||
    nonce.sessionId !== session.data.sessionId
  )
    return respond({ ok: false, code: 'FORBIDDEN' });
  const authSessionHash = await verifiedAuthSessionHash(
    context.client,
    state.profile.id,
  );
  if (!authSessionHash) return respond({ ok: false, code: 'UNAUTHENTICATED' });
  const actor = {
    actorId: state.profile.id,
    authSessionHash,
    nonceHash: enrollmentHash(nonce.nonce),
  };
  if (action === 'cancel') {
    const local = createEnrollmentDatabaseDependencies();
    return respond(
      local
        ? await cancelEnrollment(local, actor, body)
        : { ok: false, code: 'SETUP_NOT_READY' },
    );
  }
  const deps = createEnrollmentDependencies();
  if (!deps) return respond({ ok: false, code: 'PROVIDER_NOT_READY' });
  if (action === 'start') {
    const callbackState = enrollmentCallbackState(nonce.nonce);
    return respond(
      await startEnrollment(
        deps,
        actor,
        body,
        callbackState,
        enrollmentHash(callbackState),
      ),
    );
  }
  return respond(
    await (action === 'confirm' ? confirmEnrollment : reconcileEnrollment)(
      deps,
      actor,
      body,
    ),
  );
}

export async function enrollmentStatus(request: NextRequest) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: CheckoutResult<unknown>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok
          ? PAYMENT_HTTP_OK
          : CHECKOUT_ERROR_STATUS[result.code],
      }),
    );
  if (!context.configuration || !context.client || !context.port)
    return respond({ ok: false, code: 'SETUP_NOT_READY' });
  const params = request.nextUrl.searchParams;
  const parsed = enrollmentSessionSchema.safeParse({
    sessionId: params.get('session'),
  });
  if (
    !parsed.success ||
    Array.from(params.keys()).some((key) => key !== 'session') ||
    params.getAll('session').length !== 1
  )
    return respond({ ok: false, code: 'INVALID_INPUT' });
  const state = await readSession(context.port);
  if (state.status !== 'authenticated')
    return respond({
      ok: false,
      code: state.status === 'unavailable' ? 'UNAVAILABLE' : 'UNAUTHENTICATED',
    });
  const authSessionHash = await verifiedAuthSessionHash(
    context.client,
    state.profile.id,
  );
  if (!authSessionHash) return respond({ ok: false, code: 'UNAUTHENTICATED' });
  const deps = createEnrollmentDatabaseDependencies();
  if (!deps) return respond({ ok: false, code: 'PROVIDER_NOT_READY' });
  return respond(
    await readEnrollment(
      deps,
      { actorId: state.profile.id, authSessionHash },
      parsed.data,
    ),
  );
}

// Provider-required top-level GET captures encrypted authorization only, then
// strips every provider query value before any HTML/RSC document is rendered.
// The separate same-origin POST/checkbox is the only charge authorization path.
export async function enrollmentReturn(request: NextRequest) {
  const parsedEnv = getServerEnv();
  if (!parsedEnv.ok)
    return NextResponse.json(
      { ok: false, code: 'COMPLETION_UNAVAILABLE' },
      {
        status: CHECKOUT_ERROR_STATUS.COMPLETION_UNAVAILABLE,
        headers: AUTH_PRIVATE_HEADERS,
      },
    );
  const origin = parsedEnv.data.NEXT_PUBLIC_APP_URL;
  const context = createAuthContext(request.cookies.getAll());
  let path: string = routes.checkout;
  const respond = () => {
    const response = context.apply(
      NextResponse.redirect(new URL(path, origin), {
        status: AUTH_REDIRECT_STATUS,
      }),
    );
    for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
      response.headers.set(key, value);
    response.headers.set(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
    return response;
  };
  try {
    const params = request.nextUrl.searchParams;
    const session = z.uuid().safeParse(params.get('session'));
    const rawState = z
      .string()
      .length(PAYMENT_STATE_LENGTH)
      .regex(/^[A-Za-z0-9_-]+$/)
      .safeParse(params.get('state'));
    if (
      !session.success ||
      !rawState.success ||
      !context.client ||
      !context.port
    )
      return respond();
    if (
      Array.from(params.keys()).some((key) => params.getAll(key).length !== 1)
    )
      return respond();
    const nonce = readEnrollmentNonce(request);
    if (
      !nonce ||
      nonce.sessionId !== session.data ||
      enrollmentCallbackState(nonce.nonce) !== rawState.data
    )
      return respond();
    const auth = await readSession(context.port);
    if (
      auth.status !== 'authenticated' ||
      auth.profile.id !== nonce.actorId ||
      isRestricted(auth.profile)
    )
      return respond();
    const authSessionHash = await verifiedAuthSessionHash(
      context.client,
      auth.profile.id,
    );
    if (!authSessionHash) return respond();
    // Even failure/cancel GETs never change payment state; the owner sees status
    // and can explicitly cancel. Provider error messages are always discarded.
    path = enrollmentCompletePath(session.data);
    if (params.get('outcome') !== 'success') return respond();
    const deps = createEnrollmentDependencies();
    if (!deps) return respond();
    const actor = {
      actorId: auth.profile.id,
      authSessionHash,
      nonceHash: enrollmentHash(nonce.nonce),
    };
    const toss = params.has('authKey') || params.has('customerKey');
    const allowed = new Set(
      toss
        ? ['session', 'state', 'outcome', 'authKey', 'customerKey']
        : ['session', 'state', 'outcome', 'pg_token'],
    );
    if (Array.from(params.keys()).some((key) => !allowed.has(key)))
      return respond();
    const input = toss
      ? {
          provider: 'toss',
          authKey: params.get('authKey'),
          customerKey: params.get('customerKey'),
        }
      : { provider: 'kakaopay', pgToken: params.get('pg_token') };
    await captureEnrollment(
      deps,
      actor,
      session.data,
      enrollmentHash(rawState.data),
      input,
    );
    return respond();
  } catch {
    return respond();
  }
}
