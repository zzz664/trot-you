import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  MANAGEMENT_ERROR_STATUS,
  MANAGEMENT_HTTP_OK,
  type ManagementResult,
} from '@/config/subscription-management';
import { captureCancellation } from '@/server/services/analytics/capture';
import { getAnalyticsCapturePort } from '@/server/analytics/capture';
import { createAuthContext } from '@/server/auth/context';
import { createManagementDbPort } from '@/server/db/subscription-management';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import {
  cancelSubscription,
  requestRefund,
  authorizeRefund,
  rejectRefund,
  readSubscription,
  readAdminRefund,
} from '@/server/services/subscription/manage';
import { runRefund } from '@/server/services/subscription/refund';
import {
  createRefundDependencies,
  refundExecutionEnabled,
} from './dependencies';
import { managementJson } from './security';

type Action =
  'cancel' | 'request' | 'authorize' | 'reject' | 'execute' | 'reconcile';
export async function managementPost(request: NextRequest, action: Action) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: ManagementResult<unknown>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok
          ? MANAGEMENT_HTTP_OK
          : MANAGEMENT_ERROR_STATUS[result.code],
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
  const admin = !['cancel', 'request'].includes(action);
  if (admin && (isRestricted(state.profile) || state.profile.role !== 'admin'))
    return respond({ ok: false, code: 'FORBIDDEN' });
  let body: unknown;
  try {
    body = await managementJson(request);
  } catch {
    return respond({ ok: false, code: 'INVALID_INPUT' });
  }
  const db = createManagementDbPort(context.client);
  if (action === 'cancel') {
    const result = await cancelSubscription(db, body);
    if (result.ok && result.data.status === 'canceled')
      await captureCancellation(
        getAnalyticsCapturePort(),
        {
          actor_id: state.profile.id,
          subscription_id: result.data.id,
        },
        request.signal,
      );
    return respond(result);
  }
  if (action === 'request') return respond(await requestRefund(db, body));
  const enabled = refundExecutionEnabled();
  if (action === 'authorize')
    return respond(await authorizeRefund(db, body, enabled));
  if (action === 'reject')
    return respond(await rejectRefund(db, body, enabled));
  const deps = createRefundDependencies();
  return respond(
    deps
      ? await runRefund(deps, db, state.profile.id, body, action)
      : { ok: false, code: 'SETUP_NOT_READY' },
  );
}
export async function managementStatus(request: NextRequest, admin = false) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: ManagementResult<unknown>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok
          ? MANAGEMENT_HTTP_OK
          : MANAGEMENT_ERROR_STATUS[result.code],
      }),
    );
  if (!context.configuration || !context.client || !context.port)
    return respond({ ok: false, code: 'SETUP_NOT_READY' });
  const state = await readSession(context.port);
  if (state.status !== 'authenticated')
    return respond({
      ok: false,
      code: state.status === 'unavailable' ? 'UNAVAILABLE' : 'UNAUTHENTICATED',
    });
  if (admin && (isRestricted(state.profile) || state.profile.role !== 'admin'))
    return respond({ ok: false, code: 'FORBIDDEN' });
  const params = request.nextUrl.searchParams;
  const idKey = admin ? 'request' : 'subscription';
  if (
    params.getAll(idKey).length !== 1 ||
    params.getAll('page').length > 1 ||
    Array.from(params.keys()).some(
      (key) => key !== idKey && (admin || key !== 'page'),
    )
  )
    return respond({ ok: false, code: 'INVALID_INPUT' });
  const db = createManagementDbPort(context.client);
  return respond(
    admin
      ? await readAdminRefund(
          db,
          { requestId: params.get(idKey) },
          refundExecutionEnabled(),
        )
      : await readSubscription(
          db,
          { subscriptionId: params.get(idKey) },
          params.get('page') ?? 1,
        ),
  );
}
