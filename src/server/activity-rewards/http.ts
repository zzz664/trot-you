import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { ACTIVITY_REWARDS } from '@/config/activity-rewards';
import {
  POINTS_ERROR_STATUS,
  type PointsResult,
} from '@/config/attendance-points';
import { createAuthContext } from '@/server/auth/context';
import { readSession } from '@/server/services/auth/session';
import { isRestricted } from '@/server/services/auth/access';
import { createActivityRewardsPort } from '@/server/db/activity-rewards';
import {
  getActivitySnapshot,
  resolveActivityCursor,
} from '@/server/services/activity-rewards/manage';

export async function activityRewardsHttp(request: NextRequest) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: PointsResult<unknown>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok
          ? ACTIVITY_REWARDS.httpOk
          : POINTS_ERROR_STATUS[result.code],
        headers: {
          'X-Content-Type-Options': 'nosniff',
          Vary: `Cookie, ${ACTIVITY_REWARDS.actorHeader}`,
        },
      }),
    );
  try {
    if (!context.configuration || !context.client || !context.port)
      return respond({ ok: false, code: 'SETUP_NOT_READY' });
    const params = request.nextUrl.searchParams;
    if (
      request.method !== 'GET' ||
      [...params.keys()].some(
        (key) => key !== 'cursor' || params.getAll(key).length !== 1,
      )
    )
      return respond({ ok: false, code: 'INVALID_INPUT' });
    const state = await readSession(context.port);
    if (state.status !== 'authenticated')
      return respond({
        ok: false,
        code:
          state.status === 'unavailable' ? 'UNAVAILABLE' : 'UNAUTHENTICATED',
      });
    if (
      isRestricted(state.profile) ||
      (state.profile.role === 'fan' &&
        !state.profile.onboarding_completed_at) ||
      request.headers.get(ACTIVITY_REWARDS.actorHeader) !== state.profile.id
    )
      return respond({ ok: false, code: 'FORBIDDEN' });
    const cursor = resolveActivityCursor(Object.fromEntries(params));
    return respond(
      cursor.ok
        ? await getActivitySnapshot(
            createActivityRewardsPort(context.client),
            cursor.data,
            state.profile.id,
          )
        : cursor,
    );
  } catch {
    // Neither private ledger data nor auth/SQL details belong in diagnostics.
    return respond({ ok: false, code: 'UNAVAILABLE' });
  }
}
