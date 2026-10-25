import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getServerEnv } from '@/config/env.server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import {
  SCHEDULE_NOTICE,
  SCHEDULE_NOTICE_CRON_STATUS,
  scheduleNoticeWorkerSummarySchema,
} from '@/config/schedule-notices';
import { createDueScheduleNotices } from '@/server/services/schedule-notices/create-due';
import { createScheduleNoticeQueueDependencies } from './dependencies';

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
        timer = setTimeout(() => resolve(false), SCHEDULE_NOTICE.bodyTimeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}
export async function scheduleNoticeCron(request: Request) {
  const reply = (body: unknown, status: number) =>
    NextResponse.json(body, { status, headers: AUTH_PRIVATE_HEADERS });
  const error = (
    code: Exclude<keyof typeof SCHEDULE_NOTICE_CRON_STATUS, 'OK'>,
  ) => reply({ ok: false, code }, SCHEDULE_NOTICE_CRON_STATUS[code]);
  try {
    const parsed = getServerEnv();
    if (
      !parsed.ok ||
      !parsed.data.SCHEDULE_NOTICES_CRON_SECRET ||
      !parsed.data.SCHEDULE_NOTICES_ENABLED
    )
      return error('SETUP_NOT_READY');
    // Authenticate before constructing any DB dependency. General
    // CRON_SECRET, cookies, Origin and a caller-supplied query token do not work.
    if (
      !authorized(
        request.headers.get('authorization'),
        parsed.data.SCHEDULE_NOTICES_CRON_SECRET,
      )
    )
      return error('UNAUTHORIZED');
    if (
      new URL(request.url).search ||
      !['GET', 'POST'].includes(request.method) ||
      !(await emptyBody(request))
    )
      return error('INVALID_INPUT');
    const deps = createScheduleNoticeQueueDependencies();
    if (!deps) return error('SETUP_NOT_READY');
    const result = await createDueScheduleNotices(deps);
    if (!result.ok)
      return error(
        result.code === 'SETUP_NOT_READY' ? 'SETUP_NOT_READY' : 'UNAVAILABLE',
      );
    const summary = scheduleNoticeWorkerSummarySchema.safeParse(result.data);
    if (!summary.success) return error('UNAVAILABLE');
    return reply(
      { ok: true, data: summary.data },
      SCHEDULE_NOTICE_CRON_STATUS.OK,
    );
  } catch {
    return error('UNAVAILABLE');
  }
}
