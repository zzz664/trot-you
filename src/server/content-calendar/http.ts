import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  CONTENT_CALENDAR,
  CONTENT_CALENDAR_ERROR_STATUS,
  type ContentCalendarError,
  type ContentCalendarResult,
} from '@/config/content-calendar';
import { createAuthContext } from '@/server/auth/context';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { createContentCalendarPort } from '@/server/db/content-calendar';
import { createAdminArtistPort } from '@/server/db/admin-artists';
import { listAdminArtists } from '@/server/services/admin-artists/manage';
import {
  readArtistContentCalendar,
  readAdminContentCalendar,
  resolveContentCalendarMonth,
} from '@/server/services/content-calendar/read';
import {
  saveContentCalendar,
  deleteContentCalendar,
} from '@/server/services/content-calendar/manage';
import { contentCalendarBody } from './security';

export async function contentCalendarHttp(
  request: NextRequest,
  action: 'artist' | 'admin' | 'save' | 'delete',
  slug?: unknown,
) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: ContentCalendarResult<unknown>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok
          ? CONTENT_CALENDAR.httpOk
          : CONTENT_CALENDAR_ERROR_STATUS[result.code],
        headers: { 'X-Content-Type-Options': 'nosniff' },
      }),
    );
  try {
    if (!context.configuration || !context.client || !context.port)
      return respond({ ok: false, code: 'SETUP_NOT_READY' });
    const read = action === 'artist' || action === 'admin';
    const params = request.nextUrl.searchParams;
    if (
      (read ? request.method !== 'GET' : request.method !== 'POST') ||
      (read
        ? [...params.keys()].some((key) => params.getAll(key).length !== 1)
        : params.size > 0)
    )
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
    if (
      isRestricted(state.profile) ||
      state.profile.role !== (action === 'artist' ? 'artist' : 'admin') ||
      (action === 'artist' && !state.profile.onboarding_completed_at)
    )
      return respond({ ok: false, code: 'FORBIDDEN' });
    const actor = request.headers.get(CONTENT_CALENDAR.actorHeader);
    if (actor !== null && actor !== state.profile.id)
      return respond({ ok: false, code: 'FORBIDDEN' });
    if (read) {
      if (action === 'admin' && params.has('artists')) {
        if (
          params.get('artists') !== '1' ||
          [...params.keys()].some((key) => key !== 'artists' && key !== 'page')
        )
          return respond({ ok: false, code: 'INVALID_INPUT' });
        const result = await listAdminArtists(
          createAdminArtistPort(context.client),
          params.get('page'),
        );
        return respond(
          result.ok
            ? result
            : {
                ok: false,
                code: Object.hasOwn(CONTENT_CALENDAR_ERROR_STATUS, result.code)
                  ? (result.code as ContentCalendarError)
                  : 'UNAVAILABLE',
              },
        );
      }
      const query = Object.fromEntries(params);
      const artistId = query.artist_id;
      if (action === 'admin') delete query.artist_id;
      const month = resolveContentCalendarMonth(query);
      if (!month.ok) return respond(month);
      const port = createContentCalendarPort(context.client);
      return respond(
        action === 'artist'
          ? await readArtistContentCalendar(port, { slug, month: month.data })
          : await readAdminContentCalendar(port, {
              artist_id: artistId,
              month: month.data,
            }),
      );
    }
    const body = await contentCalendarBody(request);
    const port = createContentCalendarPort(context.client);
    return respond(
      await (action === 'save'
        ? saveContentCalendar(port, body)
        : deleteContentCalendar(port, body)),
    );
  } catch {
    return respond({ ok: false, code: 'UNAVAILABLE' });
  }
}
