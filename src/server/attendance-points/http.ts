import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  ATTENDANCE_POINTS,
  POINTS_ERROR_STATUS,
  type PointsResult,
} from '@/config/attendance-points';
import { createAuthContext } from '@/server/auth/context';
import { readSession } from '@/server/services/auth/session';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { createAttendancePointsPort } from '@/server/db/attendance-points';
import {
  getPointSnapshot,
  recordAttendance,
  resolvePointCursor,
} from '@/server/services/attendance-points/manage';
import { recordAttendanceObservation } from '@/server/services/attendance-points/analytics';
import { getAttendanceAnalyticsPort } from './analytics';
export type AttendancePointsAction = 'snapshot' | 'attend';
async function body(request: Request): Promise<unknown> {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim() !==
    'application/json'
  )
    return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => undefined);
      reject(new Error('INVALID_INPUT'));
    }, ATTENDANCE_POINTS.bodyTimeoutMs);
  });
  const parse = async () => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    let text = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > ATTENDANCE_POINTS.bodyLimit) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    return value;
  };
  try {
    return await Promise.race([parse(), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
export async function attendancePointsHttp(
  request: NextRequest,
  action: AttendancePointsAction,
) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: PointsResult<unknown>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok
          ? ATTENDANCE_POINTS.httpOk
          : POINTS_ERROR_STATUS[result.code],
        headers: {
          'X-Content-Type-Options': 'nosniff',
          Vary: `Cookie, ${ATTENDANCE_POINTS.actorHeader}`,
        },
      }),
    );
  try {
    if (!context.configuration || !context.client || !context.port)
      return respond({ ok: false, code: 'SETUP_NOT_READY' });
    const read = action === 'snapshot';
    const params = request.nextUrl.searchParams;
    if (
      request.method !== (read ? 'GET' : 'POST') ||
      [...params.keys()].some(
        (key) => !read || key !== 'cursor' || params.getAll(key).length !== 1,
      )
    )
      return respond({ ok: false, code: 'INVALID_INPUT' });
    if (
      !read &&
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
      isRestricted(state.profile) ||
      (state.profile.role === 'fan' &&
        !state.profile.onboarding_completed_at) ||
      request.headers.get(ATTENDANCE_POINTS.actorHeader) !== state.profile.id
    )
      return respond({ ok: false, code: 'FORBIDDEN' });
    const port = createAttendancePointsPort(context.client);
    if (read) {
      const cursor = resolvePointCursor(Object.fromEntries(params));
      return respond(
        cursor.ok
          ? await getPointSnapshot(port, cursor.data, state.profile.id)
          : cursor,
      );
    }
    const result = await recordAttendance(
      port,
      await body(request),
      state.profile.id,
    );
    if (result.ok) {
      // The immutable attendance receipt is authoritative. An optional observer
      // cannot undo it; the ledger entry, not the click, is the event identity.
      try {
        await recordAttendanceObservation(getAttendanceAnalyticsPort(), {
          actor_id: state.profile.id,
          entry_id: result.data.entry_id,
        });
      } catch {
        // Even an unexpected observer bootstrap fault cannot hide a commit.
      }
    }
    return respond(result);
  } catch {
    // Personal balances, history, operation identifiers and auth data are not logged.
    return respond({ ok: false, code: 'UNAVAILABLE' });
  }
}
