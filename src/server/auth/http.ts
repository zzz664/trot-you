import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  AUTH_CODE_MAX_LENGTH,
  AUTH_REDIRECT_STATUS,
  AUTH_PROVIDER,
} from '@/config/auth';
import { ERROR_HTTP_STATUS } from '@/config/errors';
import { routes } from '@/config/routes';
import { failure } from '@/lib/result';
import {
  authorizedReturnPath,
  isSameOriginPost,
  safeReturnPath,
} from '@/server/services/auth/access';
import { completeLogin, readSession } from '@/server/services/auth/session';
import { createAuthContext } from './context';
import { revokeWebPushSession } from '@/server/db/webpush';

const codeSchema = z
  .string()
  .min(1)
  .max(AUTH_CODE_MAX_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/);
type Context = ReturnType<typeof createAuthContext>;

function redirectResponse(context: Context, path: string) {
  // Never derive redirects from Host, X-Forwarded-Host or request.url origin.
  const location = context.configuration
    ? new URL(path, context.configuration.appOrigin).toString()
    : path;
  return context.apply(
    new NextResponse(null, {
      status: AUTH_REDIRECT_STATUS,
      headers: { Location: location },
    }),
  );
}

function forbidden(context: Context) {
  return context.apply(
    NextResponse.json(failure('FORBIDDEN'), {
      status: ERROR_HTTP_STATUS.FORBIDDEN,
    }),
  );
}

export async function loginPost(request: NextRequest) {
  const context = createAuthContext(request.cookies.getAll());
  if (!context.configuration || !context.port)
    return redirectResponse(context, `${routes.start}?reason=login_failed`);
  if (
    !isSameOriginPost(
      request.headers.get('origin'),
      context.configuration.appOrigin,
    )
  )
    return forbidden(context);
  const state = await readSession(context.port);
  const next = safeReturnPath(request.nextUrl.searchParams.get('next'));
  if (state.status === 'authenticated')
    return redirectResponse(context, authorizedReturnPath(state.profile, next));
  const callback = new URL(
    routes.authCallback,
    context.configuration.appOrigin,
  );
  // One active browser login attempt. The exact callback has no experimental
  // flow-id parameter, so SDK legacy exchange uses the latest verifier. Remove
  // previous slots/index before starting instead of leaving orphaned secrets.
  context.clearCookies(false);
  const login = await context.port.beginLogin(callback.toString());
  if (!login.ok)
    return redirectResponse(context, `${routes.start}?reason=login_failed`);
  let destination: URL;
  try {
    destination = new URL(login.data);
  } catch {
    return redirectResponse(context, `${routes.start}?reason=login_failed`);
  }
  // SDK output is still an external boundary. Only the configured Supabase
  // authorize endpoint may initiate login; never follow arbitrary provider data.
  if (
    destination.origin !== new URL(context.configuration.supabaseUrl).origin ||
    destination.pathname !== '/auth/v1/authorize' ||
    destination.searchParams.get('provider') !== AUTH_PROVIDER
  )
    return redirectResponse(context, `${routes.start}?reason=login_failed`);
  return context.apply(
    NextResponse.redirect(destination, AUTH_REDIRECT_STATUS),
  );
}

export async function callbackGet(request: NextRequest) {
  const context = createAuthContext(request.cookies.getAll());
  const params = request.nextUrl.searchParams;
  const code = codeSchema.safeParse(params.get('code'));
  if (
    !context.port ||
    !code.success ||
    params.getAll('code').length !== 1 ||
    params.has('error')
  ) {
    context.clearCookies(false);
    return redirectResponse(context, `${routes.start}?reason=callback_failed`);
  }
  const result = await completeLogin(context.port, code.data);
  // Legacy exact-URL exchange removes only the fixed verifier, not auth-js's
  // parallel flow slots/index. Consume all artifacts for this browser's attempt
  // while leaving an unrelated current session intact.
  context.clearCookies(false);
  return redirectResponse(
    context,
    result.ok
      ? authorizedReturnPath(result.data.profile, params.get('next'))
      : `${routes.start}?reason=callback_failed`,
  );
}

export async function logoutPost(request: NextRequest) {
  const context = createAuthContext(request.cookies.getAll());
  if (!context.configuration || !context.port)
    return context.apply(
      NextResponse.json(failure('INTEGRATION_UNAVAILABLE'), {
        status: ERROR_HTTP_STATUS.INTEGRATION_UNAVAILABLE,
      }),
    );
  if (
    !isSameOriginPost(
      request.headers.get('origin'),
      context.configuration.appOrigin,
    )
  )
    return forbidden(context);
  // Disable this browser session's registered endpoints before removing Auth
  // credentials. Other devices/sessions are untouched. Missing Auth sessions
  // also fail closed in the send gate; accepted in-flight pushes cannot recall.
  const pushRevoked = await revokeWebPushSession(context.client);
  const result = await context.port.signOut();
  // Also remove stale/chunked cookies if refresh/network failure prevented the
  // SDK from clearing storage. Never claim remote revocation on such failure.
  context.clearCookies();
  return redirectResponse(
    context,
    `${routes.start}?reason=${result.ok && pushRevoked ? 'signed_out' : 'logout_incomplete'}`,
  );
}
