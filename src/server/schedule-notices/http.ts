import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { SCHEDULES, SCHEDULE_ERROR_STATUS } from '@/config/schedules';
import type { ScheduleNoticeResult } from '@/config/schedule-notices';
import { createAuthContext } from '@/server/auth/context';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { createScheduleNoticePreferencePort } from '@/server/db/schedule-notice-preferences';
import {
  readScheduleNoticePreferences,
  setScheduleNoticePreference,
  setScheduleNoticeEvent,
} from '@/server/services/schedule-notices/preferences';
import { scheduleNoticeBody } from './security';

export async function scheduleNoticeHttp(
  request: NextRequest,
  action: 'read' | 'preference' | 'event',
) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: ScheduleNoticeResult<unknown>) =>
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
    const params = request.nextUrl.searchParams;
    if (
      action === 'read'
        ? request.method !== 'GET' ||
          [...params.keys()].some((key) => key !== 'id') ||
          params.getAll('id').length > 1
        : request.method !== 'POST' || params.size > 0
    )
      return respond({ ok: false, code: 'INVALID_INPUT' });
    if (
      action !== 'read' &&
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
      state.profile.role !== 'fan' ||
      isRestricted(state.profile) ||
      (state.profile.role === 'fan' && !state.profile.onboarding_completed_at)
    )
      return respond({ ok: false, code: 'FORBIDDEN' });
    const actor = request.headers.get(SCHEDULES.actorHeader);
    if (actor !== null && actor !== state.profile.id)
      return respond({ ok: false, code: 'FORBIDDEN' });
    const port = createScheduleNoticePreferencePort(context.client);
    if (action === 'read')
      return respond(
        await readScheduleNoticePreferences(port, {
          scheduleId: params.get('id'),
        }),
      );
    const body = await scheduleNoticeBody(request);
    return respond(
      await (action === 'preference'
        ? setScheduleNoticePreference(port, body)
        : setScheduleNoticeEvent(port, body)),
    );
  } catch {
    return respond({ ok: false, code: 'UNAVAILABLE' });
  }
}
