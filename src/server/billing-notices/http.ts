import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  BILLING_NOTICE_ERROR_STATUS,
  BILLING_NOTICE_HTTP_OK,
  type BillingNoticeResult,
} from '@/config/billing-notices';
import { createAuthContext } from '@/server/auth/context';
import { isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { createBillingNoticePort } from '@/server/db/billing-notices';
import {
  listBillingNotices,
  markBillingNoticeRead,
  setBillingNoticePreference,
} from '@/server/services/billing-notices/notices';
import { billingNoticeBody } from './security';

export async function billingNoticeHttp(
  request: NextRequest,
  action: 'list' | 'read' | 'preference',
) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: BillingNoticeResult<unknown>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok
          ? BILLING_NOTICE_HTTP_OK
          : BILLING_NOTICE_ERROR_STATUS[result.code],
        headers: { 'X-Content-Type-Options': 'nosniff' },
      }),
    );
  try {
    if (!context.configuration || !context.client || !context.port)
      return respond({ ok: false, code: 'SETUP_NOT_READY' });
    const params = request.nextUrl.searchParams;
    if (
      action === 'list'
        ? request.method !== 'GET' ||
          Array.from(params.keys()).some((key) => key !== 'cursor') ||
          params.getAll('cursor').length > 1
        : request.method !== 'POST' || request.nextUrl.search
    )
      return respond({ ok: false, code: 'INVALID_INPUT' });
    if (
      action !== 'list' &&
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
    const port = createBillingNoticePort(context.client);
    if (action === 'list')
      return respond(await listBillingNotices(port, params.get('cursor')));
    const body = await billingNoticeBody(request);
    return respond(
      await (action === 'read'
        ? markBillingNoticeRead(port, body)
        : setBillingNoticePreference(port, body)),
    );
  } catch {
    return respond({ ok: false, code: 'UNAVAILABLE' });
  }
}
