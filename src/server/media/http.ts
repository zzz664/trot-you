import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  MEDIA_ERROR_STATUS,
  MEDIA_HTTP_OK,
  type MediaResult,
} from '@/config/media';
import { createAuthContext } from '@/server/auth/context';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import {
  beginMediaUpload,
  completeMediaUpload,
  readMediaUrl,
  revokeMediaUpload,
} from '@/server/services/media/access';
import { createMediaDependencies } from './dependencies';
import { mediaJson } from './security';

export async function mediaPost(
  request: NextRequest,
  action: 'begin' | 'complete' | 'read' | 'revoke',
) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: MediaResult<unknown>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok ? MEDIA_HTTP_OK : MEDIA_ERROR_STATUS[result.code],
        headers: { 'X-Content-Type-Options': 'nosniff' },
      }),
    );
  if (!context.configuration || !context.client || !context.port)
    return respond({ ok: false, code: 'SETUP_NOT_READY' });
  // Resource identifiers and bearer grants never enter query strings, referer
  // headers, shared caches, logs, or caller-selected bucket/path lookups.
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
  if (
    isRestricted(state.profile) ||
    (action !== 'read' && state.profile.role === 'fan')
  )
    return respond({ ok: false, code: 'FORBIDDEN' });
  let body: unknown;
  try {
    body = await mediaJson(request);
  } catch {
    return respond({ ok: false, code: 'INVALID_INPUT' });
  }
  const deps = createMediaDependencies();
  if (!deps) return respond({ ok: false, code: 'SETUP_NOT_READY' });
  const operations = {
    begin: beginMediaUpload,
    complete: completeMediaUpload,
    read: readMediaUrl,
    revoke: revokeMediaUpload,
  };
  return respond(await operations[action](deps, state.profile.id, body));
}
