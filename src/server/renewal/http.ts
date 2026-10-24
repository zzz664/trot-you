import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getServerEnv } from '@/config/env.server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import {
  RENEWAL_BODY_TIMEOUT_MS,
  RENEWAL_HTTP_STATUS,
  renewalSummarySchema,
} from '@/config/renewal';
import { chargeDueRenewals } from '@/server/services/subscription/charge-due';
import { createRenewalDependencies } from './dependencies';

function authorized(header: string | null, secret: string) {
  if (!header || header !== `Bearer ${header.slice('Bearer '.length)}`)
    return false;
  // Equal-length digests avoid leaking secret length to a comparison exception.
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
// Next's Node adapter can expose an empty POST as a stream rather than null.
// Read only its end marker with a finite deadline; never buffer caller input.
async function emptyBody(request: Request) {
  const length = request.headers.get('content-length');
  if (
    (length !== null && length !== '0') ||
    request.headers.has('transfer-encoding')
  )
    return false;
  if (!request.body) return true;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read().then(({ done }) => done === true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), RENEWAL_BODY_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}
export async function renewalCron(request: Request) {
  const reply = (body: unknown, status: number) =>
    NextResponse.json(body, { status, headers: AUTH_PRIVATE_HEADERS });
  const error = (code: Exclude<keyof typeof RENEWAL_HTTP_STATUS, 'OK'>) =>
    reply({ ok: false, code }, RENEWAL_HTTP_STATUS[code]);
  try {
    const parsed = getServerEnv();
    if (
      !parsed.ok ||
      !parsed.data.RENEWAL_CRON_SECRET ||
      !parsed.data.PAYMENTS_RENEWALS_ENABLED
    )
      return error('SETUP_NOT_READY');
    // Authenticate before constructing any DB/provider dependency. General
    // CRON_SECRET, cookies, Origin and a caller-supplied query token do not work.
    if (
      !authorized(
        request.headers.get('authorization'),
        parsed.data.RENEWAL_CRON_SECRET,
      )
    )
      return error('UNAUTHORIZED');
    if (
      new URL(request.url).search ||
      !['GET', 'POST'].includes(request.method) ||
      !(await emptyBody(request))
    )
      return error('INVALID_INPUT');
    const deps = createRenewalDependencies();
    if (!deps) return error('SETUP_NOT_READY');
    const result = await chargeDueRenewals(deps);
    if (!result.ok) return error('UNAVAILABLE');
    const summary = renewalSummarySchema.safeParse(result.data);
    if (!summary.success) return error('UNAVAILABLE');
    return reply({ ok: true, data: summary.data }, RENEWAL_HTTP_STATUS.OK);
  } catch {
    return error('UNAVAILABLE');
  }
}
