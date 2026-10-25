import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  ADMIN_ARTIST_ERROR_STATUS,
  ADMIN_ARTIST_HTTP_OK,
  type AdminArtistAction,
  type AdminArtistResult,
} from '@/config/admin-artists';
import { createAuthContext } from '@/server/auth/context';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { createAdminArtistPort } from '@/server/db/admin-artists';
import {
  listAdminArtists,
  getAdminArtist,
  saveAdminArtist,
  setAdminArtistPreviews,
  inviteArtistAccount,
  cancelArtistInvitation,
  unlinkArtistAccount,
  listArtistInvitations,
  respondArtistInvitation,
} from '@/server/services/admin-artists/manage';
import { adminArtistBody } from './security';

export async function adminArtistHttp(
  request: NextRequest,
  action: AdminArtistAction | 'list' | 'invitations' | 'respond',
) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: AdminArtistResult<unknown>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok
          ? ADMIN_ARTIST_HTTP_OK
          : ADMIN_ARTIST_ERROR_STATUS[result.code],
        headers: { 'X-Content-Type-Options': 'nosniff' },
      }),
    );
  try {
    if (!context.configuration || !context.client || !context.port)
      return respond({ ok: false, code: 'SETUP_NOT_READY' });
    const read = action === 'list' || action === 'invitations';
    const params = request.nextUrl.searchParams;
    if (read ? request.method !== 'GET' : request.method !== 'POST')
      return respond({ ok: false, code: 'INVALID_INPUT' });
    if (action === 'list') {
      if (
        Array.from(params.keys()).some(
          (key) => key !== 'page' && key !== 'id',
        ) ||
        params.getAll('page').length > 1 ||
        params.getAll('id').length > 1
      )
        return respond({ ok: false, code: 'INVALID_INPUT' });
    } else if (action === 'invitations') {
      if (
        Array.from(params.keys()).some((key) => key !== 'page') ||
        params.getAll('page').length > 1
      )
        return respond({ ok: false, code: 'INVALID_INPUT' });
    } else if (request.nextUrl.search)
      return respond({ ok: false, code: 'INVALID_INPUT' });
    if (
      !read &&
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
        code:
          state.status === 'unavailable' ? 'UNAVAILABLE' : 'UNAUTHENTICATED',
      });
    const admin = action !== 'invitations' && action !== 'respond';
    if (
      isRestricted(state.profile) ||
      (admin && state.profile.role !== 'admin')
    )
      return respond({ ok: false, code: 'FORBIDDEN' });
    // RPCs independently lock/recheck current profiles; this UI boundary cannot
    // grant privileges from a stale session or substitute a caller actor UUID.
    const port = createAdminArtistPort(context.client);
    if (action === 'list')
      return respond(
        await (params.has('id')
          ? getAdminArtist(port, params.get('id'), params.get('page'))
          : listAdminArtists(port, params.get('page'))),
      );
    if (action === 'invitations')
      return respond(await listArtistInvitations(port, params.get('page')));
    const body = await adminArtistBody(request);
    const operations = {
      save: saveAdminArtist,
      previews: setAdminArtistPreviews,
      invite: inviteArtistAccount,
      'cancel-invite': cancelArtistInvitation,
      unlink: unlinkArtistAccount,
      respond: respondArtistInvitation,
    };
    return respond(await operations[action](port, body));
  } catch {
    return respond({ ok: false, code: 'UNAVAILABLE' });
  }
}
