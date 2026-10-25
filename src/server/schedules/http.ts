import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  SCHEDULES,
  SCHEDULE_ERROR_STATUS,
  type ScheduleResult,
} from '@/config/schedules';
import { createAuthContext } from '@/server/auth/context';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { createSchedulePort } from '@/server/db/schedules';
import { createAdminArtistPort } from '@/server/db/admin-artists';
import { listAdminArtists } from '@/server/services/admin-artists/manage';
import type { ScheduleError } from '@/config/schedules';
import {
  listSchedules,
  getSchedule,
  listAdminSchedules,
  getAdminSchedule,
  resolveScheduleQuery,
  resolveAdminScheduleQuery,
} from '@/server/services/schedules/read';
import {
  saveAdminSchedule,
  deleteAdminSchedule,
} from '@/server/services/schedules/manage';
import { scheduleBody } from './security';
export async function scheduleHttp(
  request: NextRequest,
  action: 'fan' | 'admin' | 'save' | 'delete',
) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: ScheduleResult<unknown>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok
          ? SCHEDULES.httpOk
          : SCHEDULE_ERROR_STATUS[result.code],
        headers: { 'X-Content-Type-Options': 'nosniff' },
      }),
    );
  try {
    if (!context.configuration || !context.client || !context.port)
      return respond({ ok: false, code: 'SETUP_NOT_READY' });
    const read = action === 'fan' || action === 'admin';
    const params = request.nextUrl.searchParams;
    if (
      (read ? request.method !== 'GET' : request.method !== 'POST') ||
      (read
        ? Array.from(params.keys()).some(
            (key) => params.getAll(key).length !== 1,
          )
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
      (action !== 'fan' && state.profile.role !== 'admin') ||
      (state.profile.role === 'fan' && !state.profile.onboarding_completed_at)
    )
      return respond({ ok: false, code: 'FORBIDDEN' });
    const mountedActor = request.headers.get(SCHEDULES.actorHeader);
    if (mountedActor !== null && mountedActor !== state.profile.id)
      return respond({ ok: false, code: 'FORBIDDEN' });
    const port = createSchedulePort(context.client);
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
                code: Object.hasOwn(SCHEDULE_ERROR_STATUS, result.code)
                  ? (result.code as ScheduleError)
                  : 'UNAVAILABLE',
              },
        );
      }
      if (params.has('id')) {
        if (params.size !== 1)
          return respond({ ok: false, code: 'INVALID_INPUT' });
        return respond(
          await (action === 'fan'
            ? getSchedule(port, params.get('id'))
            : getAdminSchedule(port, params.get('id'))),
        );
      }
      if (action === 'fan') {
        const query = resolveScheduleQuery(Object.fromEntries(params));
        return respond(
          query.ok ? await listSchedules(port, query.data) : query,
        );
      }
      const query = resolveAdminScheduleQuery(Object.fromEntries(params));
      return respond(
        query.ok ? await listAdminSchedules(port, query.data) : query,
      );
    }
    const body = await scheduleBody(request);
    return respond(
      await (action === 'save'
        ? saveAdminSchedule(port, body)
        : deleteAdminSchedule(port, body)),
    );
  } catch {
    return respond({ ok: false, code: 'UNAVAILABLE' });
  }
}
