import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  DISPATCH_ERROR_STATUS,
  DISPATCH_HTTP_OK,
  type DispatchResult,
} from '@/config/message-dispatch';
import { createAuthContext } from '@/server/auth/context';
import { createDispatchPort } from '@/server/db/message-dispatch';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import {
  readDispatchContext,
  submitDispatch,
  cancelDispatch,
} from '@/server/services/message-dispatch/dispatch';
import { dispatchBody } from './security';

export async function dispatchPost(
  request: NextRequest,
  slug: unknown,
  action: 'context' | 'submit' | 'cancel',
) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: DispatchResult<unknown>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok
          ? DISPATCH_HTTP_OK
          : DISPATCH_ERROR_STATUS[result.code],
        headers: { 'X-Content-Type-Options': 'nosniff' },
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
  if (request.nextUrl.search)
    return respond({ ok: false, code: 'INVALID_INPUT' });
  const state = await readSession(context.port);
  if (state.status !== 'authenticated')
    return respond({
      ok: false,
      code: state.status === 'unavailable' ? 'UNAVAILABLE' : 'UNAUTHENTICATED',
    });
  if (isRestricted(state.profile) || state.profile.role !== 'artist')
    return respond({ ok: false, code: 'FORBIDDEN' });
  const body = await dispatchBody(request);
  if (!body || Object.hasOwn(body, 'slug'))
    return respond({ ok: false, code: 'INVALID_INPUT' });
  const operation = {
    context: readDispatchContext,
    submit: submitDispatch,
    cancel: cancelDispatch,
  }[action];
  return respond(
    await operation(createDispatchPort(context.client), { ...body, slug }),
  );
}
