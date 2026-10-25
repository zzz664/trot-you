import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  ADMIN_SUBSCRIPTIONS,
  ADMIN_SUBSCRIPTION_ERROR_STATUS,
  type AdminSubscriptionResult,
} from '@/config/admin-subscriptions';
import { createAuthContext } from '@/server/auth/context';
import { isRestricted } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { createAdminSubscriptionPort } from '@/server/db/admin-subscriptions';
import {
  getAdminSubscriptionDashboard,
  resolveAdminSubscriptionQuery,
} from '@/server/services/admin-subscriptions/read';

export async function adminSubscriptionHttp(request: NextRequest) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: AdminSubscriptionResult<unknown>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok
          ? ADMIN_SUBSCRIPTIONS.httpOk
          : ADMIN_SUBSCRIPTION_ERROR_STATUS[result.code],
        headers: { 'X-Content-Type-Options': 'nosniff' },
      }),
    );
  try {
    if (!context.configuration || !context.client || !context.port)
      return respond({ ok: false, code: 'SETUP_NOT_READY' });
    const params = request.nextUrl.searchParams;
    if (
      request.method !== 'GET' ||
      Array.from(params.keys()).some((key) => params.getAll(key).length !== 1)
    )
      return respond({ ok: false, code: 'INVALID_INPUT' });
    const state = await readSession(context.port);
    if (state.status !== 'authenticated')
      return respond({
        ok: false,
        code:
          state.status === 'unavailable' ? 'UNAVAILABLE' : 'UNAUTHENTICATED',
      });
    if (isRestricted(state.profile) || state.profile.role !== 'admin')
      return respond({ ok: false, code: 'FORBIDDEN' });
    const query = resolveAdminSubscriptionQuery(Object.fromEntries(params));
    if (!query.ok) return respond(query);
    // The actor-bound RPC rechecks current authority after locking the profile.
    return respond(
      await getAdminSubscriptionDashboard(
        createAdminSubscriptionPort(context.client),
        query.data,
      ),
    );
  } catch {
    return respond({ ok: false, code: 'UNAVAILABLE' });
  }
}
