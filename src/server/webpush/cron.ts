import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getServerEnv } from '@/config/env.server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import {
  WEBPUSH,
  WEBPUSH_CRON_STATUS,
  webPushWorkerSummarySchema,
} from '@/config/webpush';
import { sendWebPushQueue } from '@/server/services/notification/send-queue';
import { createWebPushQueueDependencies } from './dependencies';

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
        timer = setTimeout(() => resolve(false), WEBPUSH.bodyTimeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}
export async function webPushCron(request: Request) {
  const reply = (body: unknown, status: number) =>
    NextResponse.json(body, { status, headers: AUTH_PRIVATE_HEADERS });
  const error = (code: Exclude<keyof typeof WEBPUSH_CRON_STATUS, 'OK'>) =>
    reply({ ok: false, code }, WEBPUSH_CRON_STATUS[code]);
  try {
    const parsed = getServerEnv();
    if (
      !parsed.ok ||
      !parsed.data.WEBPUSH_CRON_SECRET ||
      !parsed.data.WEBPUSH_WORKER_ENABLED ||
      !parsed.data.WEBPUSH_ENABLED
    )
      return error('SETUP_NOT_READY');
    // Authenticate before constructing any DB dependency. General
    // CRON_SECRET, cookies, Origin and a caller-supplied query token do not work.
    if (
      !authorized(
        request.headers.get('authorization'),
        parsed.data.WEBPUSH_CRON_SECRET,
      )
    )
      return error('UNAUTHORIZED');
    if (
      new URL(request.url).search ||
      !['GET', 'POST'].includes(request.method) ||
      !(await emptyBody(request))
    )
      return error('INVALID_INPUT');
    const deps = createWebPushQueueDependencies();
    if (!deps) return error('SETUP_NOT_READY');
    const result = await sendWebPushQueue(deps);
    if (!result.ok) return error('UNAVAILABLE');
    const summary = webPushWorkerSummarySchema.safeParse(result.data);
    if (!summary.success) return error('UNAVAILABLE');
    return reply({ ok: true, data: summary.data }, WEBPUSH_CRON_STATUS.OK);
  } catch {
    return error('UNAVAILABLE');
  }
}
