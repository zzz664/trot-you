import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  ANALYTICS_FUNNEL,
  ANALYTICS_FUNNEL_ERROR_STATUS,
  type AnalyticsFunnelResult,
} from '@/config/analytics-funnel';
import { createAuthContext } from '@/server/auth/context';
import { readSession } from '@/server/services/auth/session';
import { isRestricted } from '@/server/services/auth/access';
import { createAnalyticsFunnelPort } from '@/server/db/analytics-funnel';
import {
  getAnalyticsFunnelDashboard,
  resolveAnalyticsFunnelQuery,
} from '@/server/services/analytics-funnel/read';
export async function analyticsFunnelHttp(request: NextRequest) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: AnalyticsFunnelResult<unknown>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok
          ? ANALYTICS_FUNNEL.httpOk
          : ANALYTICS_FUNNEL_ERROR_STATUS[result.code],
        headers: {
          'X-Content-Type-Options': 'nosniff',
          Vary: `Cookie, ${ANALYTICS_FUNNEL.actorHeader}`,
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
        (key) =>
          !['from', 'to'].includes(key) || params.getAll(key).length !== 1,
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
      state.profile.role !== 'admin' ||
      request.headers.get(ANALYTICS_FUNNEL.actorHeader) !== state.profile.id
    )
      return respond({ ok: false, code: 'FORBIDDEN' });
    const query = resolveAnalyticsFunnelQuery(Object.fromEntries(params));
    return respond(
      query.ok
        ? await getAnalyticsFunnelDashboard(
            createAnalyticsFunnelPort(context.client),
            query.data,
            state.profile.id,
          )
        : query,
    );
  } catch {
    return respond({ ok: false, code: 'UNAVAILABLE' });
  }
}
