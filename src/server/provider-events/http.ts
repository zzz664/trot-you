import 'server-only';
import { NextResponse } from 'next/server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { RECONCILIATION_HTTP_STATUS } from '@/config/reconciliation';
import { getServerEnv } from '@/config/env.server';
import { receiveTossEvent } from '@/server/services/reconciliation/receive';
import { readTossProviderEvent } from './security';
import { createProviderReceiptDependencies } from './dependencies';
export async function tossPaymentWebhook(request: Request) {
  const reply = (body: unknown, status: number) =>
    NextResponse.json(body, { status, headers: AUTH_PRIVATE_HEADERS });
  const error = (
    code: Exclude<keyof typeof RECONCILIATION_HTTP_STATUS, 'OK'>,
  ) => reply({ ok: false, code }, RECONCILIATION_HTTP_STATUS[code]);
  try {
    const env = getServerEnv();
    if (!env.ok || !env.data.PAYMENTS_RECONCILIATION_ENABLED)
      return error('SETUP_NOT_READY');
    if (new URL(request.url).search) return error('INVALID_INPUT');
    const parsed = await readTossProviderEvent(request);
    if (!parsed.ok) return error(parsed.code);
    const deps = createProviderReceiptDependencies();
    if (!deps) return error('SETUP_NOT_READY');
    const result = await receiveTossEvent(deps, parsed.data);
    return result.ok
      ? reply({ ok: true }, RECONCILIATION_HTTP_STATUS.OK)
      : error('UNAVAILABLE');
  } catch {
    return error('UNAVAILABLE');
  }
}
