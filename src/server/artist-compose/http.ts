import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  COMPOSE_ERROR_STATUS,
  COMPOSE_HTTP_OK,
  type ComposeResult,
} from '@/config/artist-compose';
import { createAuthContext } from '@/server/auth/context';
import { createComposePort } from '@/server/db/artist-compose';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import {
  readComposeContext,
  saveComposeDraft,
  previewComposeDraft,
  removeComposeMedia,
} from '@/server/services/artist-compose/compose';
import { composeBody } from './security';

export async function composePost(
  request: NextRequest,
  slug: unknown,
  action: 'context' | 'save' | 'preview' | 'remove',
) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: ComposeResult<unknown>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok ? COMPOSE_HTTP_OK : COMPOSE_ERROR_STATUS[result.code],
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
  const body = await composeBody(request);
  if (!body || Object.hasOwn(body, 'slug'))
    return respond({ ok: false, code: 'INVALID_INPUT' });
  const operation = {
    context: readComposeContext,
    save: saveComposeDraft,
    preview: previewComposeDraft,
    remove: removeComposeMedia,
  }[action];
  return respond(
    await operation(createComposePort(context.client), { ...body, slug }),
  );
}
