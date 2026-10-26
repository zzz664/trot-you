import { z } from 'zod';
import {
  ATTENDANCE_POINTS,
  POINTS_ERROR_STATUS,
  pointCursorSchema,
  pointSnapshotSchema,
  pointBefore,
  attendanceInputSchema,
  attendanceReceiptSchema,
  type PointsResult,
  type PointsError,
  type PointCursor,
  type AttendanceInput,
} from '@/config/attendance-points';
import { pointsHistoryPath, routes } from '@/config/routes';
async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  signal?: AbortSignal,
  actorKey?: string,
): Promise<PointsResult<T>> {
  if (!z.uuid().safeParse(actorKey).success)
    return { ok: false, code: 'FORBIDDEN' };
  if (signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
  try {
    const timeout = AbortSignal.timeout(ATTENDANCE_POINTS.requestTimeoutMs);
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(actorKey ? { [ATTENDANCE_POINTS.actorHeader]: actorKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (
      response.headers.get('content-type')?.split(';')[0]?.trim() !==
      'application/json'
    )
      return { ok: false, code: 'UNAVAILABLE' };
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, code: 'UNAVAILABLE' };
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    let text = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > ATTENDANCE_POINTS.responseMaxBytes) {
          await reader.cancel();
          return { ok: false, code: 'UNAVAILABLE' };
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const parsed = z
      .union([
        z.strictObject({ ok: z.literal(true), data: schema }),
        z.strictObject({ ok: z.literal(false), code: z.string() }),
      ])
      .safeParse(JSON.parse(text));
    if (!parsed.success) return { ok: false, code: 'UNAVAILABLE' };
    if (parsed.data.ok)
      return response.status === ATTENDANCE_POINTS.httpOk
        ? parsed.data
        : { ok: false, code: 'UNAVAILABLE' };
    if (Object.hasOwn(POINTS_ERROR_STATUS, parsed.data.code)) {
      const code = parsed.data.code as PointsError;
      if (response.status === POINTS_ERROR_STATUS[code])
        return { ok: false, code };
    }
  } catch {
    /* No personal point history or session data in diagnostics. */
  }
  return { ok: false, code: 'UNAVAILABLE' };
}
export async function fetchPointSnapshot(
  cursor: PointCursor | null,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const input = pointCursorSchema.nullable().safeParse(cursor);
  if (!input.success)
    return { ok: false as const, code: 'INVALID_INPUT' as const };
  const result = await request(
    pointsHistoryPath(input.data ? JSON.stringify(input.data) : null),
    pointSnapshotSchema,
    undefined,
    signal,
    actorKey,
  );
  return result.ok &&
    (result.data.actor_id !== actorKey?.toLowerCase() ||
      (input.data !== null &&
        result.data.entries.some((entry) => !pointBefore(entry, input.data!))))
    ? { ok: false as const, code: 'UNAVAILABLE' as const }
    : result;
}
export async function checkAttendance(
  input: AttendanceInput,
  signal?: AbortSignal,
  actorKey?: string,
) {
  const parsed = attendanceInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, code: 'INVALID_INPUT' as const };
  const result = await request(
    routes.pointsAttendanceApi,
    attendanceReceiptSchema,
    parsed.data,
    signal,
    actorKey,
  );
  return result.ok &&
    (result.data.actor_id !== actorKey?.toLowerCase() ||
      result.data.operation_id !== parsed.data.operation_id)
    ? { ok: false as const, code: 'UNAVAILABLE' as const }
    : result;
}
